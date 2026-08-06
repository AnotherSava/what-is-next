import { getPrisma } from "@/lib/db";
import { getEnabledProviders } from "./config";
import type { AudioTrack } from "./source";
import { PROVIDER_PRIORITY, type MediaProvider, type PresenceRef } from "./types";

// Read-side helpers for library presence badges + watch links. "In your library" = the user has a MediaPresence
// row for that catalog item on a CONNECTED server; season presence is the subset of rows with a seasonNumber.
// Every row carries the item's key on its own server, which — with that server's id — builds a deep link to watch
// it (see link.ts). Explicit userId (§5a).
//
// Every read is scoped to the currently enabled providers. Switching a server off doesn't delete its rows (a
// re-enable should get its library back without a full re-scan), so an unscoped read would keep reporting a
// decommissioned server's titles as owned and hand its dead item keys to the play button.
//
// With two servers connected an item can appear twice. The reads below collapse that to one answer using
// PROVIDER_PRIORITY, so a card shows a single play link and a single source spec rather than two competing ones.

// Lower is better. A row from a provider not in the priority list (an unknown value in the column) sorts last.
function priorityOf(provider: string): number {
  const i = PROVIDER_PRIORITY.indexOf(provider as MediaProvider);
  return i === -1 ? PROVIDER_PRIORITY.length : i;
}

// Pick the row the UI should speak for: the highest-priority provider, preferring a row that actually carries an
// item key (a key-less row predates key capture and can't build a watch link).
function bestOf<T extends { provider: string; itemKey?: string | null }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (!best) {
      best = r;
      continue;
    }
    const better =
      priorityOf(r.provider) < priorityOf(best.provider) ||
      (priorityOf(r.provider) === priorityOf(best.provider) && best.itemKey == null && r.itemKey != null);
    if (better) best = r;
  }
  return best;
}

function refOf(row: { provider: string; itemKey?: string | null } | null): PresenceRef | null {
  return row ? { provider: row.provider as MediaProvider, itemKey: row.itemKey ?? null } : null;
}

// mediaItemId → where to play it. Membership in the map == "in your library" on at least one connected server.
// Presence rows aren't media-typed, so this serves both shows and movies; callers key by their own item ids.
export async function getPresenceRefs(userId: string): Promise<Map<string, PresenceRef>> {
  const rows = await getPrisma().mediaPresence.findMany({
    where: { userId, provider: { in: await getEnabledProviders() } },
    select: { mediaItemId: true, provider: true, itemKey: true },
  });
  const byItem = new Map<string, { provider: string; itemKey: string | null }>();
  for (const r of rows) {
    // A show has one row per season; bestOf's tiebreak also picks a keyed row over a key-less one.
    const current = byItem.get(r.mediaItemId);
    byItem.set(r.mediaItemId, current ? bestOf([current, r])! : r);
  }
  return new Map([...byItem].map(([id, row]) => [id, refOf(row)!]));
}

// The set of episodeIds present in the user's library — the per-episode counterpart of getPresenceRefs, unioned
// across connected servers (having an episode on either one means you can watch it). Written by
// applyEpisodePresence; the Download view checks aired-unwatched episodes against it to find what's missing.
export async function getEpisodePresence(userId: string): Promise<Set<string>> {
  const rows = await getPrisma().mediaEpisodePresence.findMany({
    where: { userId, provider: { in: await getEnabledProviders() } },
    select: { episodeId: true },
  });
  return new Set(rows.map((r) => r.episodeId));
}

// Where to play SPECIFIC episodes. Membership in the whole-library map isn't enough for a per-episode play button:
// with two servers connected, one may hold the show (so it wins the item-level ref) while only the other holds the
// episode you actually want — linking to the first would open a page where that episode doesn't exist. So this
// intersects the two, per episode: the highest-priority provider that holds BOTH the episode and a key for its show.
export async function getPlayableEpisodeRefs(userId: string, episodeIds: string[]): Promise<Map<string, PresenceRef>> {
  if (episodeIds.length === 0) return new Map();
  const prisma = getPrisma();
  const enabled = await getEnabledProviders();
  const episodeRows = await prisma.mediaEpisodePresence.findMany({
    where: { userId, provider: { in: enabled }, episodeId: { in: episodeIds } },
    select: { episodeId: true, mediaItemId: true, provider: true },
  });
  if (episodeRows.length === 0) return new Map();

  // The show-level key for each provider that holds one of these episodes.
  const showRows = await prisma.mediaPresence.findMany({
    where: {
      userId,
      provider: { in: enabled },
      mediaItemId: { in: [...new Set(episodeRows.map((r) => r.mediaItemId))] },
      itemKey: { not: null },
    },
    select: { mediaItemId: true, provider: true, itemKey: true },
  });
  const keyOf = new Map(showRows.map((r) => [`${r.mediaItemId}|${r.provider}`, r.itemKey]));

  const out = new Map<string, PresenceRef>();
  for (const r of episodeRows) {
    const itemKey = keyOf.get(`${r.mediaItemId}|${r.provider}`);
    if (itemKey == null) continue; // that server has the episode but no key to link to — can't build a URL
    const candidate: PresenceRef = { provider: r.provider as MediaProvider, itemKey };
    const current = out.get(r.episodeId);
    if (!current || priorityOf(candidate.provider) < priorityOf(current.provider)) out.set(r.episodeId, candidate);
  }
  return out;
}

export interface MoviePresence {
  ref: PresenceRef; // which server holds it + its key there → the watch deep link
  videoResolution: string | null; // resolution token ("4k"|"1080"|…); format for display via source.ts formatResolution
  hdrFormat: string | null; // combined HDR label ("Dolby Vision · HDR10"|…); null = SDR/unknown
  audioTracks: AudioTrack[]; // audio-row languages (best copy), [] when unknown
  subtitleLangs: string[]; // subtitle-row languages (best copy), [] when unknown
}

// One movie's presence in a single query, for the movie detail page: whether it's in a library (non-null return),
// its watch link, and its source (resolution/HDR/audio/subtitles) for the Video/Audio/Subtitles rows. A movie has
// one presence row per server (seasonNumber null), so this one query answers membership, the link and the source
// together — the detail page needs none of the whole-library map getPresenceRefs builds for the grid.
export async function getMoviePresence(userId: string, mediaItemId: string): Promise<MoviePresence | null> {
  const rows = await getPrisma().mediaPresence.findMany({
    where: { userId, mediaItemId, seasonNumber: null, provider: { in: await getEnabledProviders() } },
    select: {
      provider: true,
      itemKey: true,
      videoResolution: true,
      hdrFormat: true,
      audioTracks: true,
      subtitleLangs: true,
    },
  });
  const row = bestOf(rows);
  if (!row) return null;
  return {
    ref: refOf(row)!,
    videoResolution: row.videoResolution,
    hdrFormat: row.hdrFormat,
    audioTracks: parseJson<AudioTrack[]>(row.audioTracks, []),
    subtitleLangs: parseJson<string[]>(row.subtitleLangs, []),
  };
}

// Tolerant JSON parse for the stored source lists — a null/blank/corrupt value yields the fallback, never a throw.
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// One season's source (resolution/HDR/audio/subtitles), for the show detail page's per-season media pill. Same
// shape as a movie's source minus the ref — a show has one presence row per season per server, each carrying its
// own source, since quality often differs across seasons.
export interface SeasonSource {
  videoResolution: string | null; // resolution token ("4k"|"1080"|…); format for display via source.ts formatResolution
  hdrFormat: string | null; // combined HDR label ("Dolby Vision · HDR10"|…); null = SDR/unknown
  audioTracks: AudioTrack[]; // audio-row languages, [] when unknown
  subtitleLangs: string[]; // subtitle-row languages, [] when unknown
}

export interface ShowPresence {
  seasons: Set<number>; // seasons present on at least one connected server
  sources: Map<number, SeasonSource>; // per season, the preferred server's source
  ref: PresenceRef | null; // where to play the show
}

// Presence for one show in a single query: which seasons are in a library, each season's source (for the media
// pill), and where to play it. Membership in `seasons` == "this season is in your library".
export async function getShowPresence(userId: string, mediaItemId: string): Promise<ShowPresence> {
  const rows = await getPrisma().mediaPresence.findMany({
    where: { userId, mediaItemId, provider: { in: await getEnabledProviders() } },
    select: {
      provider: true,
      seasonNumber: true,
      itemKey: true,
      videoResolution: true,
      hdrFormat: true,
      audioTracks: true,
      subtitleLangs: true,
    },
  });
  const seasons = new Set<number>();
  const bySeason = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.seasonNumber == null) continue;
    seasons.add(r.seasonNumber);
    const current = bySeason.get(r.seasonNumber);
    bySeason.set(r.seasonNumber, current ? bestOf([current, r])! : r);
  }
  const sources = new Map<number, SeasonSource>(
    [...bySeason].map(([season, r]) => [
      season,
      {
        videoResolution: r.videoResolution,
        hdrFormat: r.hdrFormat,
        audioTracks: parseJson<AudioTrack[]>(r.audioTracks, []),
        subtitleLangs: parseJson<string[]>(r.subtitleLangs, []),
      },
    ]),
  );
  return { seasons, sources, ref: refOf(bestOf(rows)) };
}
