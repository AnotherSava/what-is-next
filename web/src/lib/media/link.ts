import { getSetting, SYNC_KEYS } from "@/lib/settings";
import { getMediaServers } from "./config";
import { MEDIA_PROVIDERS, PROVIDER_LABEL, type MediaProvider, type PresenceRef } from "./types";

// Deep links that open an item on the server holding it, so a poster's play button lands on that server's own
// details page — where its Play button honours the saved playback offset (i.e. resumes a partly-watched episode
// from your spot rather than restarting).
//
// Each provider needs a different pair of facts, both captured by the sync: Plex needs only the server's
// machineIdentifier (the link goes through app.plex.tv), Jellyfin needs its own base URL plus the server id.

// What a link needs about one server: the id recorded by the last sync, and where that server lives.
export interface ServerLink {
  serverId: string | null;
  url: string;
}

export type ServerLinks = Record<MediaProvider, ServerLink>;

// The Plex web app routes to the user's own server via its machineIdentifier and opens the preplay page. The
// `#!/…?key=…` fragment is the Plex web app's own routing convention (same as its share links); `key` is the
// URL-encoded metadata path.
export function plexWebUrl(machineIdentifier: string, ratingKey: string): string {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(machineIdentifier)}/details?key=${key}`;
}

// The Jellyfin web client is served by the server itself and uses a hash router; `#/details?id=…&serverId=…` is
// the route its own item links build (verified against the served client bundle, Jellyfin 10.11).
export function jellyfinWebUrl(baseUrl: string, serverId: string, itemId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/web/#/details?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(serverId)}`;
}

// Where a play button should send you: the URL plus the name of the server it opens, so the button can say which
// one ("Play Dune in Jellyfin") instead of a bare "Play".
export interface WatchTarget {
  url: string;
  provider: MediaProvider;
  server: string; // display name — "Plex" | "Jellyfin"
}

// A watch target for a presence ref, or null when anything needed is missing (no ref, no item key, or the server
// id hasn't been recorded yet) — the poster then renders plain, with no play overlay.
export function watchTarget(ref: PresenceRef | null | undefined, links: ServerLinks): WatchTarget | null {
  if (!ref?.itemKey) return null;
  const link = links[ref.provider];
  if (!link?.serverId) return null;
  const url =
    ref.provider === "plex"
      ? plexWebUrl(link.serverId, ref.itemKey)
      : link.url // Jellyfin links are relative to the server's own address
        ? jellyfinWebUrl(link.url, link.serverId, ref.itemKey)
        : null;
  return url ? { url, provider: ref.provider, server: PROVIDER_LABEL[ref.provider] } : null;
}

export async function getServerLinks(): Promise<ServerLinks> {
  const [config, ...ids] = await Promise.all([
    getMediaServers(),
    ...MEDIA_PROVIDERS.map((p) => getSetting(SYNC_KEYS[p].server)),
  ]);
  return Object.fromEntries(
    MEDIA_PROVIDERS.map((p, i) => [p, { serverId: ids[i]?.serverId ?? null, url: config[p].url }]),
  ) as ServerLinks;
}

// The convenience a page reaches for: resolve every server's link facts once, then turn each item's presence ref
// into a target with no further awaits inside the render.
export type WatchLinker = (ref: PresenceRef | null | undefined) => WatchTarget | null;

export async function getWatchLinker(): Promise<WatchLinker> {
  const links = await getServerLinks();
  return (ref) => watchTarget(ref, links);
}
