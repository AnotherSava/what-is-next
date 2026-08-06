// Provider-neutral vocabulary for the media-server integration (Plex + Jellyfin). Both servers answer the same
// three questions — what's in the library, what's been watched, and what quality the copy is — so everything
// downstream of a scan speaks these types and nothing else. Each provider's own module turns its API into them.

export const MEDIA_PROVIDERS = ["plex", "jellyfin"] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

// Display name for a provider — the one place UI copy gets it, so "Jellyfin" can't be spelled two ways.
export const PROVIDER_LABEL: Record<MediaProvider, string> = { plex: "Plex", jellyfin: "Jellyfin" };

// Preference order when an item is present on BOTH servers: the first enabled provider holding it wins the play
// link and the displayed source. Plex first because its deep link resumes playback at the saved offset.
export const PROVIDER_PRIORITY: MediaProvider[] = ["plex", "jellyfin"];

export type MediaKind = "tv" | "movie";

// Where a catalog item lives on a server: which provider, and its id on that server (Plex ratingKey / Jellyfin
// item id). Enough to build a watch deep link — see media/link.ts.
export interface PresenceRef {
  provider: MediaProvider;
  itemKey: string | null; // null on rows written before the key was captured, until the next sync back-fills them
}

// One row of the presence snapshot a scan produces: a movie (seasonNumber null) or one TV season.
export interface PresenceRow {
  mediaItemId: string;
  seasonNumber: number | null;
  itemKey: string; // the show/movie's id on the server — lets the UI deep-link into it to watch
  // The source of this row's copy. Set only when derived this sync (sourceDerived); when omitted, applyPresence
  // carries the previously-stored source for this row forward rather than nulling it out.
  videoResolution?: string | null; // resolution token ("4k"|"1080"|…)
  hdrFormat?: string | null; // combined HDR label ("Dolby Vision · HDR10"|…); null = SDR
  audioTracks?: string | null; // audio languages as JSON [{lang,code,atmos}]
  subtitleLangs?: string | null; // subtitle languages as JSON string[]
  sourceDerived?: boolean; // true = the four source fields were derived this sync (else inherit the stored ones)
}

// A watched item observed on a server, to be reconciled into the SeenEvent log. seasonNumber/episodeNumber null =
// a movie; both set = a TV episode (resolved to an episodeId via the catalog inside applyWatched).
export interface WatchedSignal {
  mediaItemId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date | null;
}

// An episode present in a show's library, before catalog resolution — resolved to an episodeId inside
// applyEpisodePresence, mirroring how WatchedSignal defers its episodeId lookup.
export interface EpisodePresenceSignal {
  seasonNumber: number;
  episodeNumber: number;
}

// A library item that isn't yet in the tracker — surfaced for the "review, then add" flow. Carries the external
// ids (to hydrate from TMDB) + the server item key (to read episode watch state) + whether it's been watched.
export interface LibraryCandidate {
  itemKey: string;
  mediaType: MediaKind;
  title: string;
  year: number | null;
  tmdbId: number | null;
  tvdbId: number | null;
  imdbId: string | null;
  watched: boolean;
  watchedAt: string | null; // ISO timestamp of the last watch — the movie watch date when adopted; null if unknown
}

// A library item the scan can't reconcile: it matched no catalog entry AND carries no external id
// (tmdb/tvdb/imdb), so — unlike a candidate — it can't be auto-hydrated from TMDB and tracked. Almost always
// means the server itself hasn't matched the file to a metadata agent. Surfaced for the admin so these otherwise
// invisible files aren't silently dropped; the remedy is to fix the match on the server.
export interface UnaccountedItem {
  itemKey: string;
  mediaType: MediaKind;
  title: string;
  year: number | null;
}

// Per-show cursors that keep a steady-state sync cheap. Keyed by the show's item key ON THAT SERVER, so each
// provider has its own key space and its own stored cursor set.
export interface ScanCursors {
  // itemKey → total watched-episode count at the last scan. An unchanged count means no new watches to import.
  watch: Record<string, number>;
  // itemKey → total episode count at the last scan. An unchanged count means the presence snapshot didn't move.
  presence: Record<string, number>;
  // itemKey → number of seasons whose source was derived. Presence of a key means "already captured once".
  source: Record<string, number>;
}

export interface ScanResult {
  matchedShows: number;
  matchedMovies: number;
  presenceSeasons: number;
  presenceRows: PresenceRow[];
  watchedSignals: WatchedSignal[];
  candidates: LibraryCandidate[];
  cursors: ScanCursors;
  // Every matched TV show's mediaItemId this scan, whether or not its episodes were fetched — lets
  // applyEpisodePresence drop presence rows for shows that fell out of the library.
  matchedShowIds: string[];
  // mediaItemId → that show's key on the server, for every matched show. Cursors are keyed by the server's id
  // while the writers work in catalog ids, so this is what lets a failed catalog resolution invalidate the right
  // cursor entry (see syncProvider).
  matchedShowKeys: Record<string, string>;
  // mediaItemId → the episodes present on the server, only for shows re-fetched this scan (their episode count
  // changed). Other still-matched shows are absent here and keep their existing presence rows.
  episodePresence: Record<string, EpisodePresenceSignal[]>;
  unaccounted: UnaccountedItem[];
}

// What a provider module must supply for the shared orchestration to drive it. Deliberately free of Prisma: a
// scanner turns its server's API into the types above and looks the catalog up through the injected index, which
// keeps every scanner unit-testable with a fake client and no database.
export interface MediaScanner {
  readonly provider: MediaProvider;
  // The library snapshot: presence, watch signals, candidates, and the cursors for the next run.
  scan(catalog: CatalogIndex, cursors: ScanCursors): Promise<ScanResult>;
  // The server's stable id, used to build watch deep links.
  getServerId(): Promise<string>;
  // Watch signals for a candidate the user just adopted into tracking (a movie's own watch state, or a show's
  // episodes fetched on demand).
  watchedSignalsForCandidate(candidate: LibraryCandidate, mediaItemId: string): Promise<WatchedSignal[]>;
}

// External-id → mediaItemId lookup over the whole catalog, per media type. Built once per sync (see
// media/catalog.ts) and shared by every scanner.
export interface CatalogIndex {
  find(kind: MediaKind, ids: { tmdbId: number | null; tvdbId: number | null; imdbId: string | null }): string | null;
}
