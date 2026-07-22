import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/app/_components/BackLink";
import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { downloadLinksFor } from "@/lib/downloadSources";
import { formatResolution, isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { isEndedStatus } from "@/lib/progress";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getDownloadSources, getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";
import { getShowDetail } from "@/lib/shows";
import { languageName } from "@/lib/tmdb";
import { CastColumn } from "../_components/CastColumn";
import { SeasonList, type SeasonListSeason } from "../_components/SeasonList";
import { ShowHeroMenu } from "../_components/ShowHeroMenu";
import { ShowHeroPoster } from "../_components/ShowHeroPoster";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPrisma().mediaItem.findFirst({
    where: { mediaType: "tv", OR: [{ slug }, { id: slug }] },
    select: { title: true },
  });
  return { title: item?.title ?? "Show" };
}

export default async function ShowDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [show, manualWatched, plexServerId, sources] = await Promise.all([
    getShowDetail(displayedUser.id, slug),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
    getDownloadSources(),
  ]);
  if (!show) notFound();
  // Canonicalise: an id-based (or otherwise non-slug) URL 308-redirects to /shows/<slug> once a slug exists.
  if (show.slug && show.slug !== slug) redirect(`/shows/${show.slug}`);

  const { progress } = show;
  // Manual watch-editing is gated on the owner AND the "mark watched" setting; the favourite/kebab need only owner.
  const canMark = canEdit && manualWatched;
  const watchUrl = plexWatchUrl(plexServerId, show.plexRatingKey);
  const rating = show.imdbRating ?? show.tmdbRating;
  const progressPct = progress.airedCount > 0 ? Math.round((progress.watchedAiredCount / progress.airedCount) * 100) : null;
  const hasWatches = show.seasons.some((s) => s.watchedCount > 0);
  const stars = show.cast.slice(0, 3).map((c) => c.name).join(" · ");

  // Year range: first release year → "present" (still running) or the last season's year (ended). Seasons/episodes
  // counts exclude specials — those are side content, not part of the run.
  const regular = show.seasons.filter((s) => !s.isSpecials);
  const firstYear = show.releaseDate?.slice(0, 4) ?? regular.find((s) => s.year != null)?.year?.toString() ?? null;
  const endYear = [...regular].reverse().find((s) => s.year != null)?.year ?? null;
  const ended = isEndedStatus(show.status);
  const yearTo = ended ? (endYear != null && String(endYear) !== firstYear ? String(endYear) : null) : "present";
  const seasonCount = regular.length;
  const episodeCount = progress.totalCounted;

  // Open the season holding the next unwatched episode; if caught up, the latest regular season.
  const lastRegular = regular.length ? regular[regular.length - 1].seasonNumber : (show.seasons.at(-1)?.seasonNumber ?? null);
  const initialOpenSeason = progress.nextUp?.seasonNumber ?? lastRegular;

  // The show's original-language audio is the track you'd watch it in; warn per season when it's absent from Plex.
  // Unknown original (TVDB-sourced / not-yet-refreshed / the "xx" no-language placeholder) → no audio warning at all.
  const originalAudioLang = show.originalLanguage && show.originalLanguage !== "xx" ? languageName(show.originalLanguage) : null;

  const seasonRows: SeasonListSeason[] = show.seasons.map((s) => {
    const source = s.source;
    const audioTracks = source?.audioTracks ?? [];
    const subtitleLangs = source?.subtitleLangs ?? [];
    const videoLabel = source ? [formatResolution(source.videoResolution), source.hdrFormat].filter(Boolean).join(" ") || null : null;
    const query = s.isSpecials ? show.title : `${show.title} S${String(s.seasonNumber).padStart(2, "0")}`;
    return {
      seasonNumber: s.seasonNumber,
      label: s.isSpecials ? "Specials" : `Season ${s.seasonNumber}`,
      year: s.year,
      airedCount: s.airedCount,
      watchedCount: s.watchedCount,
      fullyWatched: s.airedCount > 0 && s.watchedCount >= s.airedCount,
      inPlex: s.inPlex,
      videoLabel,
      audioWarning: originalAudioLang && audioTracks.length > 0 && !audioTracks.some((t) => t.code === show.originalLanguage || (t.code == null && t.lang === originalAudioLang)) ? `No ${originalAudioLang} audio` : null,
      subtitleWarning: subtitleLangs.length > 0 && !subtitleLangs.includes("English") ? "No English subtitles" : null,
      downloadLinks: s.inPlex ? [] : downloadLinksFor(sources, "shows", query),
      latestWatchedISO: s.latestWatchedAtISO,
      latestWatchedLabel: s.latestWatchedAtLabel,
      episodes: s.episodes.map((e) => ({
        id: e.id,
        episodeNumber: e.episodeNumber,
        title: e.title ?? "TBA",
        aired: e.aired,
        watched: e.watched,
        watchedISO: e.watchedAtISO,
        watchedLabel: e.watchedAtLabel,
        airsLabel: e.airsLabel,
      })),
    };
  });

  return (
    <div>
      <BackLink
        fallbackHref="/shows"
        className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      />

      <div className="relative">
        {canEdit && show.tracked && (
          <div className="absolute top-0 right-0 z-[6]">
            <ShowHeroMenu showId={show.id} hasWatches={hasWatches} />
          </div>
        )}

        <div className="flex flex-col gap-8 pt-2 md:flex-row md:items-start md:gap-[34px]">
          <ShowHeroPoster
            showId={show.id}
            title={show.title}
            posterPath={show.posterPath}
            watchUrl={watchUrl}
            rating={rating}
            isFavorite={show.isFavorite}
            canFavorite={canEdit}
            progressPct={progressPct}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="font-display text-[28px] leading-[1.03] font-bold tracking-[-0.02em] text-balance md:text-[40px]">{show.title}</h1>
            {show.originalTitle && show.originalTitle !== show.title && (
              <p className="font-narrow mt-1.5 text-[14px] text-[var(--color-muted)]">{show.originalTitle}</p>
            )}

            <div className="font-num mt-3.5 text-[14px] tabular-nums text-[var(--color-muted)]">
              {firstYear && (
                <>
                  <span className="font-medium text-[#e6e6ea]">{firstYear}</span>
                  {yearTo && <span className="text-[#4e4e57]"> – </span>}
                  {yearTo && <span className="text-[#9a9aa4] italic">{yearTo}</span>}
                  {" · "}
                </>
              )}
              <span className="text-[var(--color-bright)]">{seasonCount}</span> {seasonCount === 1 ? "season" : "seasons"}
              {" · "}
              <span className="text-[var(--color-bright)]">{episodeCount}</span> {episodeCount === 1 ? "episode" : "episodes"}
            </div>

            {(show.creator || stars) && (
              <div className="mt-[18px] flex max-w-[600px] flex-col gap-2">
                {show.creator && <HeroSpecRow label="Creator" value={show.creator} />}
                {stars && <HeroSpecRow label="Stars" value={stars} />}
              </div>
            )}

            {show.overview && <p className="mt-5 max-w-[600px] text-[14px] leading-[1.6] text-[var(--color-bright)] text-pretty">{show.overview}</p>}
          </div>
        </div>
      </div>

      <div className="mt-[38px] flex flex-col gap-10 md:flex-row md:gap-[72px]">
        <SeasonList
          showId={show.id}
          seasons={seasonRows}
          canEdit={canMark}
          nextUpEpisodeId={progress.nextUp?.id ?? null}
          initialOpenSeason={initialOpenSeason}
          today={todayISO()}
        />
        <CastColumn cast={show.cast} />
      </div>
    </div>
  );
}

// A label/value row in the show hero's identity block (matches the movie hero's Director/Stars rows): a fixed-width
// faint label + a wider Archivo Narrow value.
function HeroSpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3.5">
      <span className="font-num w-[74px] shrink-0 text-[12px] tracking-[0.02em] text-[var(--color-faint)]">{label}</span>
      <span className="font-narrow min-w-0 flex-1 text-[15px] text-[#d3d3da]">{value}</span>
    </div>
  );
}
