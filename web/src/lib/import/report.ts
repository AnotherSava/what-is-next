// Reconciliation report for the importer (brief §6.4). Built up as the import runs and printed at the end;
// the CLI also writes it (and the unresolved items) to JSON so nothing is lost between runs.

export interface UnresolvedSeries {
  title: string;
  tvdbId: number | null;
  reason: string;
}
export interface UnresolvedMovie {
  title: string;
  year: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  reason: string;
}
export interface MovieByTitleSearch {
  title: string;
  year: number | null;
  matchedTmdbId: number | null;
  matchedTitle: string | null;
}
export interface UnmatchedEpisode {
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  isWatched: boolean;
}
export interface UnresolvedListItem {
  listName: string;
  type: string;
  tvdbId: number;
  name: string | null;
}
export interface GdprDiscrepancy {
  tvdbId: number;
  showName: string;
  gdprSeen: number;
  importedSeen: number;
}

export interface ImportReport {
  startedAt: string;
  finishedAt: string;
  dir: string;
  series: { total: number; resolved: number; unresolved: UnresolvedSeries[] };
  movies: {
    total: number;
    resolved: number;
    unresolved: UnresolvedMovie[];
    searchedByTitle: MovieByTitleSearch[];
  };
  episodes: {
    totalInExport: number;
    matched: number;
    unmatched: UnmatchedEpisode[];
    unmatchedWatched: number;
  };
  seenEvents: { episodes: number; movies: number };
  favorites: { series: number; movies: number };
  lists: { count: number; items: number; unresolvedItems: UnresolvedListItem[] };
  // Soft, self-healing warnings that don't count as unresolved (e.g. a season that failed to hydrate and will
  // be retried on the next import/refresh run).
  warnings: string[];
  gdpr: { checked: number; discrepancies: GdprDiscrepancy[] } | { skipped: string } | null;
}

export function emptyReport(dir: string, startedAt: string): ImportReport {
  return {
    startedAt,
    finishedAt: startedAt,
    dir,
    series: { total: 0, resolved: 0, unresolved: [] },
    movies: { total: 0, resolved: 0, unresolved: [], searchedByTitle: [] },
    episodes: { totalInExport: 0, matched: 0, unmatched: [], unmatchedWatched: 0 },
    seenEvents: { episodes: 0, movies: 0 },
    favorites: { series: 0, movies: 0 },
    lists: { count: 0, items: 0, unresolvedItems: [] },
    warnings: [],
    gdpr: null,
  };
}

// Compact summary persisted to the Setting `import:lastReport` for the admin page (matches importSummarySchema).
export function summarizeReport(r: ImportReport) {
  return {
    at: r.finishedAt,
    dir: r.dir,
    seriesResolved: r.series.resolved,
    seriesTotal: r.series.total,
    moviesResolved: r.movies.resolved,
    moviesTotal: r.movies.total,
    episodesMatched: r.episodes.matched,
    episodesTotal: r.episodes.totalInExport,
    unmatchedWatched: r.episodes.unmatchedWatched,
    seenEpisodes: r.seenEvents.episodes,
    seenMovies: r.seenEvents.movies,
    favoriteSeries: r.favorites.series,
    favoriteMovies: r.favorites.movies,
    lists: r.lists.count,
    listItems: r.lists.items,
    unresolved: [
      ...r.series.unresolved.map((u) => `series "${u.title}" (tvdb ${u.tvdbId}) — ${u.reason}`),
      ...r.movies.unresolved.map((u) => `movie "${u.title}" (${u.year}) — ${u.reason}`),
    ],
    warnings: r.warnings,
  };
}

// Annotates each line with the brief §6.4 expectation so a bad run is obvious at a glance.
export function formatReport(r: ImportReport): string {
  const pct = r.episodes.totalInExport > 0 ? (100 * r.episodes.matched) / r.episodes.totalInExport : 0;
  const lines: string[] = [];
  lines.push("── Import reconciliation ──────────────────────────────────");
  lines.push(`Source: ${r.dir}`);
  lines.push(`Series:   ${r.series.resolved}/${r.series.total} resolved            (expect 83)`);
  lines.push(`Movies:   ${r.movies.resolved}/${r.movies.total} resolved            (expect 99)`);
  lines.push(
    `Episodes: ${r.episodes.matched}/${r.episodes.totalInExport} matched (${pct.toFixed(1)}%)  (expect ≈3766, >98%)`,
  );
  lines.push(
    `          ${r.episodes.unmatched.length} unmatched, of which ${r.episodes.unmatchedWatched} were watched`,
  );
  lines.push(`SeenEvents (episodes): ${r.seenEvents.episodes}          (expect 1948)`);
  lines.push(`SeenEvents (movies):   ${r.seenEvents.movies}            (expect 81)`);
  lines.push(`Favorites: ${r.favorites.series} series + ${r.favorites.movies} movies   (expect 17 + 8)`);
  lines.push(`Lists: ${r.lists.count} with ${r.lists.items} items          (expect 1 with 5)`);

  const unresolvedCount = r.series.unresolved.length + r.movies.unresolved.length;
  lines.push(`Unresolved IDs: ${unresolvedCount}                     (expect ≤2)`);
  for (const s of r.series.unresolved) lines.push(`   • series "${s.title}" (tvdb ${s.tvdbId}) — ${s.reason}`);
  for (const m of r.movies.unresolved) lines.push(`   • movie "${m.title}" (${m.year}) — ${m.reason}`);

  if (r.movies.searchedByTitle.length > 0) {
    lines.push(`Movies resolved by title search (confirm manually): ${r.movies.searchedByTitle.length}`);
    for (const m of r.movies.searchedByTitle) {
      lines.push(`   • "${m.title}" (${m.year}) → tmdb ${m.matchedTmdbId} "${m.matchedTitle}"`);
    }
  }

  if (r.episodes.unmatchedWatched > 0) {
    lines.push(`Unmatched WATCHED episodes (lost history if not fixed):`);
    for (const e of r.episodes.unmatched.filter((x) => x.isWatched)) {
      lines.push(`   • ${e.showTitle} S${e.seasonNumber}E${e.episodeNumber}`);
    }
  }

  if (r.warnings.length > 0) {
    lines.push(`Warnings (self-healing on re-run): ${r.warnings.length}`);
    for (const w of r.warnings) lines.push(`   • ${w}`);
  }

  if (r.gdpr && "checked" in r.gdpr) {
    lines.push(`GDPR cross-check: ${r.gdpr.checked} shows compared, ${r.gdpr.discrepancies.length} discrepancies`);
    for (const d of r.gdpr.discrepancies.slice(0, 20)) {
      lines.push(`   • ${d.showName} (tvdb ${d.tvdbId}): GDPR ${d.gdprSeen} vs imported ${d.importedSeen}`);
    }
    if (r.gdpr.discrepancies.length > 20) lines.push(`   … and ${r.gdpr.discrepancies.length - 20} more`);
  } else if (r.gdpr && "skipped" in r.gdpr) {
    lines.push(`GDPR cross-check: skipped (${r.gdpr.skipped})`);
  }

  lines.push("───────────────────────────────────────────────────────────");
  return lines.join("\n");
}
