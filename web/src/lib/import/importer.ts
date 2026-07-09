import type { MediaItem, PrismaClient } from "@/generated/prisma/client";
import { movieDetailToMediaData, tvDetailToMediaData, upsertCatalogSeason } from "@/lib/catalog";
import { TmdbError, type TmdbClient, type TmdbMovieDetail, type TmdbMovieSummary, type TmdbTvDetail } from "@/lib/tmdb";
import { crossCheck, parseUserTvShowData } from "./gdpr";
import {
  flattenSeriesEpisodes,
  matchEpisodes,
  parseWatchedAt,
  trackingForMovie,
  trackingForSeriesStatus,
  type EpisodeMatch,
} from "./mapping";
import { emptyReport, type ImportReport } from "./report";
import type { TvtimeList, TvtimeMovie, TvtimeSeries } from "./schemas";

// Importer orchestrator (brief §6). Takes ALREADY-parsed + validated export data and writes it idempotently:
// catalog rows are keyed by external IDs, user-state rows by (userId, …), and provenance is tagged
// source="tvtime-import" so a re-run converges rather than duplicating. It never throws on a single bad item —
// TMDB failures and unmatched episodes land in the reconciliation report. File reading + zod validation happen
// in the CLI (scripts/import.ts); this class stays pure orchestration so it's reusable and dep-injectable.

export interface ImporterDeps {
  prisma: PrismaClient;
  tmdb: TmdbClient;
  ownerId: string;
  log?: (msg: string) => void;
}

export interface ImportInput {
  series: TvtimeSeries[];
  movies: TvtimeMovie[];
  lists: TvtimeList[];
  gdprCsv?: string | null;
}

export class Importer {
  private readonly prisma: PrismaClient;
  private readonly tmdb: TmdbClient;
  private readonly ownerId: string;
  private readonly log: (msg: string) => void;
  private report: ImportReport;

  // Preloaded provenance sets so re-runs skip already-imported SeenEvents (the append-only log has no natural
  // unique key — brief §6). episode set keyed by catalog episodeId; movie set keyed by mediaItemId.
  private readonly seenEpisodes = new Set<string>();
  private readonly seenMovies = new Set<string>();

  constructor(deps: ImporterDeps, dir: string, startedAt: string) {
    this.prisma = deps.prisma;
    this.tmdb = deps.tmdb;
    this.ownerId = deps.ownerId;
    this.log = deps.log ?? (() => {});
    this.report = emptyReport(dir, startedAt);
  }

  async run(input: ImportInput): Promise<ImportReport> {
    await this.preloadSeen();
    this.report.series.total = input.series.length;
    this.report.movies.total = input.movies.length;

    let i = 0;
    for (const s of input.series) {
      i++;
      this.log(`[series ${i}/${input.series.length}] ${s.title}`);
      await this.processSeries(s);
    }
    i = 0;
    for (const m of input.movies) {
      i++;
      this.log(`[movie ${i}/${input.movies.length}] ${m.title}`);
      await this.processMovie(m);
    }
    await this.processLists(input.lists);
    await this.crossCheckGdpr(input.gdprCsv ?? null);

    this.report.finishedAt = new Date().toISOString();
    return this.report;
  }

  private async preloadSeen(): Promise<void> {
    const events = await this.prisma.seenEvent.findMany({
      where: { userId: this.ownerId, source: "tvtime-import" },
      select: { episodeId: true, mediaItemId: true },
    });
    for (const e of events) {
      if (e.episodeId) this.seenEpisodes.add(e.episodeId);
      else this.seenMovies.add(e.mediaItemId);
    }
  }

  // ── series ───────────────────────────────────────────────────────────────
  private async processSeries(series: TvtimeSeries): Promise<void> {
    const tvdbId = series.id.tvdb ?? null;
    if (tvdbId == null) {
      this.report.series.unresolved.push({ title: series.title, tvdbId: null, reason: "no TVDB id in export" });
      return;
    }

    const { item, resolved } = await this.ensureSeriesItem(series, tvdbId);
    await this.writeSeriesUserState(series, item);
    if (series.is_favorite) this.report.favorites.series++;
    if (!resolved) return; // stub has no catalog episodes to match

    const catalogEps = await this.prisma.episode.findMany({
      where: { mediaItemId: item.id },
      select: { id: true, seasonNumber: true, episodeNumber: true },
    });
    const exportEps = flattenSeriesEpisodes(series);
    const { matched, unmatched } = matchEpisodes(exportEps, catalogEps);
    this.report.episodes.totalInExport += exportEps.length;
    this.report.episodes.matched += matched.length;
    for (const u of unmatched) {
      this.report.episodes.unmatched.push({
        showTitle: series.title,
        seasonNumber: u.seasonNumber,
        episodeNumber: u.episodeNumber,
        isWatched: u.isWatched,
      });
      if (u.isWatched) this.report.episodes.unmatchedWatched++;
    }
    await this.backfillEpisodeTvdbIds(matched);
    await this.writeSeriesSeenEvents(item.id, matched);
    this.report.series.resolved++;
  }

  private async ensureSeriesItem(
    series: TvtimeSeries,
    tvdbId: number,
  ): Promise<{ item: MediaItem; resolved: boolean }> {
    const existing = await this.prisma.mediaItem.findUnique({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "tv" } },
    });
    if (existing && !existing.needsDetails && existing.tmdbId != null) return { item: existing, resolved: true };

    let tmdbId = existing?.tmdbId ?? null;
    if (tmdbId == null)
      tmdbId = await this.safe(() => this.tmdb.findByTvdb(tvdbId).then((f) => f.tv_results[0]?.id ?? null));

    if (tmdbId == null) {
      this.report.series.unresolved.push({ title: series.title, tvdbId, reason: "TMDB /find returned no tv result" });
      return { item: await this.upsertSeriesStub(series, tvdbId), resolved: false };
    }

    // Dedup: a different TVDB id may already map to this TMDB id (TVDB duplicates that TMDB merges). Writing a
    // fresh row for this tvdb would carry the already-claimed tmdbId and blow the @@unique([tmdbId, mediaType])
    // constraint — aborting the whole import. Reuse the canonical row instead (its user-state merges naturally).
    const canonical = await this.prisma.mediaItem.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType: "tv" } },
    });
    if (canonical && canonical.tvdbId !== tvdbId) {
      this.log(`  = tvdb ${tvdbId} shares tmdb ${tmdbId} with "${canonical.title}" — reusing canonical row`);
      this.report.warnings.push(
        `"${series.title}" (tvdb ${tvdbId}) shares tmdb ${tmdbId} with "${canonical.title}" — merged`,
      );
      const item = await this.ensureSeriesHydrated(canonical, tmdbId, series.title);
      return { item, resolved: !item.needsDetails };
    }

    const detail = await this.safe(() => this.tmdb.getTvDetail(tmdbId!));
    if (!detail) {
      this.report.series.unresolved.push({
        title: series.title,
        tvdbId,
        reason: `TMDB tv/${tmdbId} detail fetch failed`,
      });
      return { item: await this.upsertSeriesStub(series, tvdbId), resolved: false };
    }
    const item = await this.upsertSeriesFromDetail(series, tvdbId, detail);
    const complete = await this.hydrateSeasons(item.id, tmdbId, detail);
    if (!complete) {
      // Some seasons failed transiently — keep needsDetails so the next run re-hydrates (not a permanent miss).
      await this.prisma.mediaItem.update({ where: { id: item.id }, data: { needsDetails: true } });
      this.report.warnings.push(`"${series.title}" partially hydrated (some seasons failed) — will retry on re-run`);
      return { item: { ...item, needsDetails: true }, resolved: true };
    }
    return { item, resolved: true };
  }

  // Hydrate an already-existing canonical row on demand (used when two TVDB ids map to one TMDB id).
  private async ensureSeriesHydrated(canonical: MediaItem, tmdbId: number, exportTitle: string): Promise<MediaItem> {
    if (!canonical.needsDetails) return canonical;
    const detail = await this.safe(() => this.tmdb.getTvDetail(tmdbId));
    if (!detail) return canonical;
    const complete = await this.hydrateSeasons(canonical.id, tmdbId, detail);
    const updated = await this.prisma.mediaItem.update({
      where: { id: canonical.id },
      data: { needsDetails: !complete, lastRefreshedAt: new Date() },
    });
    if (!complete)
      this.report.warnings.push(`"${exportTitle}" partially hydrated (some seasons failed) — will retry on re-run`);
    return updated;
  }

  private upsertSeriesFromDetail(series: TvtimeSeries, tvdbId: number, detail: TmdbTvDetail): Promise<MediaItem> {
    const data = {
      ...tvDetailToMediaData(detail),
      mediaType: "tv",
      tvdbId, // the export's tvdbId is authoritative for the natural key (may differ from TMDB's external id)
      imdbId: detail.external_ids?.imdb_id ?? series.id.imdb ?? null,
      lastRefreshedAt: new Date(),
      needsDetails: false,
    };
    return this.prisma.mediaItem.upsert({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "tv" } },
      create: data,
      update: data,
    });
  }

  private upsertSeriesStub(series: TvtimeSeries, tvdbId: number): Promise<MediaItem> {
    return this.prisma.mediaItem.upsert({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "tv" } },
      create: { mediaType: "tv", tvdbId, imdbId: series.id.imdb ?? null, title: series.title, needsDetails: true },
      update: { title: series.title },
    });
  }

  // Returns true only if EVERY season hydrated. A transient failure on one season returns false so the caller
  // keeps the show needsDetails=true and a re-run re-fetches it (rather than silently, permanently missing it).
  // The per-season DB write is the shared catalog upsert (upsertCatalogSeason); the importer owns the
  // TmdbError-safe fetching (this.safe rethrows non-TMDB errors).
  private async hydrateSeasons(mediaItemId: string, tmdbId: number, detail: TmdbTvDetail): Promise<boolean> {
    let complete = true;
    for (const stub of detail.seasons ?? []) {
      const season = await this.safe(() => this.tmdb.getSeasonDetail(tmdbId, stub.season_number));
      if (!season) {
        complete = false;
        continue;
      }
      await upsertCatalogSeason(this.prisma, mediaItemId, stub.season_number, season, stub);
    }
    return complete;
  }

  private async writeSeriesUserState(series: TvtimeSeries, item: MediaItem): Promise<void> {
    const tracking = trackingForSeriesStatus(series.status);
    const createdAt = parseWatchedAt(series.created_at ?? null);
    await this.prisma.userMediaState.upsert({
      where: { userId_mediaItemId: { userId: this.ownerId, mediaItemId: item.id } },
      create: {
        userId: this.ownerId,
        mediaItemId: item.id,
        tracking,
        isFavorite: series.is_favorite,
        ...(createdAt ? { createdAt } : {}),
      },
      update: { tracking, isFavorite: series.is_favorite }, // never clobber createdAt on re-run
    });
  }

  private async backfillEpisodeTvdbIds(matched: EpisodeMatch[]): Promise<void> {
    for (const m of matched) {
      if (m.ref.tvdbId == null) continue;
      await this.prisma.episode.updateMany({
        where: { id: m.catalogEpisodeId, tvdbId: null },
        data: { tvdbId: m.ref.tvdbId },
      });
    }
  }

  private async writeSeriesSeenEvents(mediaItemId: string, matched: EpisodeMatch[]): Promise<void> {
    for (const m of matched) {
      if (!m.ref.isWatched) continue;
      const episodeId = m.catalogEpisodeId;
      if (this.seenEpisodes.has(episodeId)) continue;
      await this.prisma.seenEvent.create({
        data: {
          userId: this.ownerId,
          mediaItemId,
          episodeId,
          watchedAt: parseWatchedAt(m.ref.watchedAt),
          source: "tvtime-import",
        },
      });
      this.seenEpisodes.add(episodeId);
      this.report.seenEvents.episodes++;
    }
  }

  // ── movies ─────────────────────────────────────────────────────────────
  private async processMovie(movie: TvtimeMovie): Promise<void> {
    const tvdbId = movie.id.tvdb ?? null;
    if (tvdbId == null) {
      this.report.movies.unresolved.push({
        title: movie.title,
        year: movie.year ?? null,
        imdbId: movie.id.imdb ?? null,
        tvdbId: null,
        reason: "no TVDB id in export (cannot key)",
      });
      return;
    }
    const { item, resolved } = await this.ensureMovieItem(movie, tvdbId);
    await this.writeMovieUserState(movie, item);
    if (movie.is_favorite) this.report.favorites.movies++;
    if (movie.is_watched) await this.writeMovieSeenEvent(movie, item);
    if (resolved) this.report.movies.resolved++;
  }

  private async ensureMovieItem(movie: TvtimeMovie, tvdbId: number): Promise<{ item: MediaItem; resolved: boolean }> {
    const existing = await this.prisma.mediaItem.findUnique({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "movie" } },
    });
    if (existing && !existing.needsDetails && existing.tmdbId != null) return { item: existing, resolved: true };

    const imdbId = movie.id.imdb ?? null;
    let tmdbId = existing?.tmdbId ?? null;
    if (tmdbId == null && imdbId) {
      tmdbId = await this.safe(() => this.tmdb.findByImdb(imdbId).then((f) => f.movie_results[0]?.id ?? null));
    }
    if (tmdbId == null) {
      // The 1 export movie without an imdb id (brief §6.2) → search by title+year, logged for manual confirm.
      const best = await this.safe(() =>
        this.tmdb.searchMovie(movie.title).then((r) => this.pickBestMovie(r.results, movie.year ?? null)),
      );
      tmdbId = best?.id ?? null;
      this.report.movies.searchedByTitle.push({
        title: movie.title,
        year: movie.year ?? null,
        matchedTmdbId: tmdbId,
        matchedTitle: best?.title ?? null,
      });
    }

    if (tmdbId != null) {
      // Same dedup as series: a different tvdb resolving to an already-claimed tmdb would violate
      // @@unique([tmdbId, mediaType]) and abort the import. Reuse the canonical row.
      const canonical = await this.prisma.mediaItem.findUnique({
        where: { tmdbId_mediaType: { tmdbId, mediaType: "movie" } },
      });
      if (canonical && canonical.tvdbId !== tvdbId) {
        this.log(`  = movie tvdb ${tvdbId} shares tmdb ${tmdbId} with "${canonical.title}" — reusing canonical row`);
        this.report.warnings.push(
          `Movie "${movie.title}" (tvdb ${tvdbId}) shares tmdb ${tmdbId} with "${canonical.title}" — merged`,
        );
        return { item: canonical, resolved: !canonical.needsDetails };
      }
      const detail = await this.safe(() => this.tmdb.getMovieDetail(tmdbId!));
      if (detail) return { item: await this.upsertMovieFromDetail(movie, tvdbId, detail), resolved: true };
      this.report.movies.unresolved.push({
        title: movie.title,
        year: movie.year ?? null,
        imdbId,
        tvdbId,
        reason: `TMDB movie/${tmdbId} detail fetch failed`,
      });
    } else {
      this.report.movies.unresolved.push({
        title: movie.title,
        year: movie.year ?? null,
        imdbId,
        tvdbId,
        reason: "no TMDB match by imdb or title",
      });
    }
    return { item: await this.upsertMovieStub(movie, tvdbId), resolved: false };
  }

  private pickBestMovie(results: TmdbMovieSummary[], year: number | null): TmdbMovieSummary | null {
    if (results.length === 0) return null;
    if (year != null) {
      const exact = results.find((r) => r.release_date?.startsWith(String(year)));
      if (exact) return exact;
    }
    return results[0];
  }

  private upsertMovieFromDetail(movie: TvtimeMovie, tvdbId: number, detail: TmdbMovieDetail): Promise<MediaItem> {
    const data = {
      ...movieDetailToMediaData(detail),
      mediaType: "movie",
      tvdbId, // the export's tvdbId is authoritative for the natural key
      imdbId: detail.external_ids?.imdb_id ?? movie.id.imdb ?? null,
      lastRefreshedAt: new Date(),
      needsDetails: false,
    };
    return this.prisma.mediaItem.upsert({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "movie" } },
      create: data,
      update: data,
    });
  }

  private upsertMovieStub(movie: TvtimeMovie, tvdbId: number): Promise<MediaItem> {
    return this.prisma.mediaItem.upsert({
      where: { tvdbId_mediaType: { tvdbId, mediaType: "movie" } },
      create: { mediaType: "movie", tvdbId, imdbId: movie.id.imdb ?? null, title: movie.title, needsDetails: true },
      update: { title: movie.title },
    });
  }

  private async writeMovieUserState(movie: TvtimeMovie, item: MediaItem): Promise<void> {
    const tracking = trackingForMovie(movie);
    const createdAt = parseWatchedAt(movie.created_at ?? null);
    await this.prisma.userMediaState.upsert({
      where: { userId_mediaItemId: { userId: this.ownerId, mediaItemId: item.id } },
      create: {
        userId: this.ownerId,
        mediaItemId: item.id,
        tracking,
        isFavorite: movie.is_favorite,
        ...(createdAt ? { createdAt } : {}),
      },
      update: { tracking, isFavorite: movie.is_favorite },
    });
  }

  private async writeMovieSeenEvent(movie: TvtimeMovie, item: MediaItem): Promise<void> {
    if (this.seenMovies.has(item.id)) return;
    await this.prisma.seenEvent.create({
      data: {
        userId: this.ownerId,
        mediaItemId: item.id,
        episodeId: null,
        watchedAt: parseWatchedAt(movie.watched_at ?? null),
        source: "tvtime-import",
      },
    });
    this.seenMovies.add(item.id);
    this.report.seenEvents.movies++;
  }

  // ── lists ──────────────────────────────────────────────────────────────
  private async processLists(lists: TvtimeList[]): Promise<void> {
    for (const list of lists) {
      const createdAt = parseWatchedAt(list.created_at ?? null);
      const dbList = await this.prisma.list.upsert({
        where: { userId_name: { userId: this.ownerId, name: list.name } },
        create: {
          userId: this.ownerId,
          name: list.name,
          description: list.description ?? null,
          ...(createdAt ? { createdAt } : {}),
        },
        update: { description: list.description ?? null },
      });
      this.report.lists.count++;
      for (const it of list.items) {
        const mediaType = it.type === "movie" ? "movie" : "tv";
        const mi = await this.prisma.mediaItem.findUnique({
          where: { tvdbId_mediaType: { tvdbId: it.tvdb_id, mediaType } },
        });
        if (!mi) {
          this.report.lists.unresolvedItems.push({
            listName: list.name,
            type: it.type,
            tvdbId: it.tvdb_id,
            name: it.name ?? null,
          });
          continue;
        }
        // ListItem's unique includes a nullable episodeId; SQLite treats NULLs as distinct, so upsert-by-key
        // can't dedupe null-episode rows. Find-then-write keeps list import idempotent.
        const existing = await this.prisma.listItem.findFirst({
          where: { listId: dbList.id, mediaItemId: mi.id, episodeId: null },
        });
        if (existing)
          await this.prisma.listItem.update({ where: { id: existing.id }, data: { position: it.custom_order } });
        else
          await this.prisma.listItem.create({
            data: { listId: dbList.id, mediaItemId: mi.id, position: it.custom_order },
          });
        this.report.lists.items++;
      }
    }
  }

  // ── GDPR cross-check ─────────────────────────────────────────────────────
  private async crossCheckGdpr(gdprCsv: string | null): Promise<void> {
    if (!gdprCsv) {
      this.report.gdpr = { skipped: "user_tv_show_data.csv not found next to the export" };
      return;
    }
    const rows = parseUserTvShowData(gdprCsv);
    if (rows.length === 0) {
      this.report.gdpr = { skipped: "user_tv_show_data.csv empty or unparseable" };
      return;
    }
    const grouped = await this.prisma.seenEvent.groupBy({
      by: ["mediaItemId"],
      where: { userId: this.ownerId, source: "tvtime-import", episodeId: { not: null } },
      _count: true,
    });
    const items = await this.prisma.mediaItem.findMany({
      where: { id: { in: grouped.map((g) => g.mediaItemId) } },
      select: { id: true, tvdbId: true },
    });
    const tvdbByItem = new Map(items.map((i) => [i.id, i.tvdbId]));
    const importedByTvdb = new Map<number, number>();
    for (const g of grouped) {
      const tvdb = tvdbByItem.get(g.mediaItemId);
      if (tvdb != null) importedByTvdb.set(tvdb, (importedByTvdb.get(tvdb) ?? 0) + g._count);
    }
    this.report.gdpr = crossCheck(rows, importedByTvdb);
  }

  // Run a TMDB call, converting a TmdbError (or any thrown error) into null so one bad lookup never aborts the
  // whole import. Non-TMDB programming errors are rethrown.
  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TmdbError) {
        this.log(`  ! TMDB error (${err.status ?? "network"}) on ${err.path ?? "?"}: ${err.message}`);
        return null;
      }
      throw err;
    }
  }
}
