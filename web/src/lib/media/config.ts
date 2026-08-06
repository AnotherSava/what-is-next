import { getPrisma } from "@/lib/db";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/secrets";
import { readSetting, setSetting } from "@/lib/settings";
import { MEDIA_PROVIDERS, type MediaProvider } from "./types";

// Media-server connection settings. The database is the source of truth — the owner edits these on /admin, and
// every "is Plex/Jellyfin on?" check reads from here (which is why those checks are async).
//
// The PLEX_* / JELLYFIN_* environment variables are a SEED, not config: the first time this row is read on a
// deployment that has none, they populate it and it's written back. After that the stored values win and the
// variables are ignored, so editing a token on /admin isn't silently overwritten by a stale env on next boot.
//
// Tokens are ENCRYPTED in the row and decrypted on the way out (see lib/secrets.ts), so a copy of the database
// — a nightly backup, a downloaded snapshot — carries no usable credential. Everything above this module works
// in plaintext: the boundary is exactly getMediaServers/setMediaServer.

export interface MediaServerConfig {
  enabled: boolean;
  url: string;
  token: string; // Plex X-Plex-Token / Jellyfin API key
  libraries: string; // comma-separated library names to sync; blank = all TV + movie libraries
  user: string; // Jellyfin only: which account's watch state to read; blank = the server's only/first user
}

export type MediaServersConfig = Record<MediaProvider, MediaServerConfig>;

const DEFAULT_PORT: Record<MediaProvider, number> = { plex: 32400, jellyfin: 8096 };

// Where each server lives when nothing says otherwise — the documented defaults, and what the Plex integration
// already assumed when only PLEX_TOKEN was set.
const DEFAULT_URL: Record<MediaProvider, string> = {
  plex: "http://localhost:32400",
  jellyfin: "http://localhost:8096",
};

// Make a hand-typed server address usable: trim it, add a scheme when it's missing, and — only for a BARE host
// with neither scheme nor port ("192.168.1.5", "media-box") — add the provider's default port, since that form
// can't reach the server otherwise. An address that already names a scheme or port is left alone, so
// "https://jellyfin.example.com" keeps its implicit 443.
export function normalizeServerUrl(provider: MediaProvider, raw: string): string {
  const input = raw.trim().replace(/\/+$/, "");
  if (!input) return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  const bare = !hasScheme && !/:\d+$/.test(input);
  const withScheme = hasScheme ? input : `http://${input}`;
  try {
    const url = new URL(withScheme);
    if (bare) url.port = String(DEFAULT_PORT[provider]);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return withScheme; // unparseable — keep what the owner typed so they can see and fix it
  }
}

function blank(): MediaServerConfig {
  return { enabled: false, url: "", token: "", libraries: "", user: "" };
}

// The seed described at the top of the file: whatever the environment names, with the connection switched on when
// a token is present (which is exactly how the Plex feature used to gate itself).
function fromEnv(): MediaServersConfig {
  const seed = (
    provider: MediaProvider,
    url: string | undefined,
    token: string | undefined,
    libraries = "",
  ): MediaServerConfig => ({
    enabled: Boolean(token),
    // A token with no URL still means "use this server" — fall back to its default address rather than seeding a
    // blank one, which isUsable would read as "not connected", silently switching the integration off.
    url: normalizeServerUrl(provider, url?.trim() || (token ? DEFAULT_URL[provider] : "")),
    token: token ?? "",
    libraries,
    user: "",
  });
  return {
    plex: seed("plex", process.env.PLEX_URL, process.env.PLEX_TOKEN, process.env.PLEX_LIBRARIES ?? ""),
    jellyfin: seed("jellyfin", process.env.JELLYFIN_URL, process.env.JELLYFIN_API_KEY),
  };
}

export async function getMediaServers(): Promise<MediaServersConfig> {
  const { present, value } = await readSetting("settings:mediaServers");
  if (value) {
    // A row written before tokens were encrypted still holds them in the clear. Rewrite it now rather than waiting
    // for the owner to next save, so the plaintext stops being copied into tonight's backup. Best-effort: this is
    // a read, reached from ordinary page renders, so a failure here must not take the page down with it — the
    // values are still perfectly usable, they just stay in the clear until the next successful write.
    if (MEDIA_PROVIDERS.some((p) => value[p].token && !isEncrypted(value[p].token))) {
      try {
        await setSetting("settings:mediaServers", encryptTokens(decryptTokens(value)));
        // Overwriting the row is not enough: SQLite leaves the old cell's bytes in the file's free space, where
        // the plaintext stays greppable — and gets copied verbatim into every backup, which is the exposure this
        // encryption exists to close. VACUUM rebuilds the file without that residue. It runs once, on the single
        // read that performs the upgrade, and never again.
        await getPrisma().$executeRawUnsafe("VACUUM");
      } catch (e) {
        console.warn(`[media] could not encrypt stored credentials: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return decryptTokens(value);
  }
  // Present but unreadable: don't overwrite what the owner configured — treat both servers as off until they
  // re-save from /admin, which rewrites the row cleanly.
  if (present) return { plex: blank(), jellyfin: blank() };
  const seeded = fromEnv();
  await setSetting("settings:mediaServers", encryptTokens(seeded));
  return seeded;
}

// The two halves of the storage boundary: everything outside this module sees plaintext tokens, everything in the
// Setting row is ciphertext.
function decryptTokens(stored: MediaServersConfig): MediaServersConfig {
  return mapTokens(stored, decryptSecret);
}

function encryptTokens(plain: MediaServersConfig): MediaServersConfig {
  return mapTokens(plain, encryptSecret);
}

function mapTokens(config: MediaServersConfig, f: (token: string) => string): MediaServersConfig {
  return Object.fromEntries(
    MEDIA_PROVIDERS.map((p) => [p, { ...config[p], token: f(config[p].token) }]),
  ) as MediaServersConfig;
}

export async function getMediaServer(provider: MediaProvider): Promise<MediaServerConfig> {
  return (await getMediaServers())[provider];
}

// Persist one provider's connection, leaving the other's untouched. The URL is normalized on the way in so the
// admin form shows the address the client will actually call.
export async function setMediaServer(provider: MediaProvider, config: MediaServerConfig): Promise<void> {
  const all = await getMediaServers(); // plaintext tokens…
  await setSetting(
    "settings:mediaServers",
    encryptTokens({
      // …re-encrypted together on the way back in, so the untouched provider's token is rewritten too rather than
      // being written back in the clear.
      ...all,
      [provider]: {
        enabled: config.enabled,
        url: normalizeServerUrl(provider, config.url),
        token: config.token.trim(),
        libraries: config.libraries.trim(),
        user: config.user.trim(),
      },
    }),
  );
}

// A connection counts as usable only when it's switched on AND has somewhere to call with something to call it
// with — an enabled-but-blank row must not make the app act as though a library exists.
export function isUsable(config: MediaServerConfig): boolean {
  return config.enabled && Boolean(config.url) && Boolean(config.token);
}

// The providers a sync should actually run, in preference order.
export async function getEnabledProviders(): Promise<MediaProvider[]> {
  const all = await getMediaServers();
  return MEDIA_PROVIDERS.filter((p) => isUsable(all[p]));
}

// Whether ANY media server is connected — the gate for presence badges, the Download view, the on-view freshener
// and the nav's Synced pill. Async because it reads the stored connections, where the Plex-only predecessor
// read an environment variable synchronously.
export async function isMediaServerEnabled(): Promise<boolean> {
  return (await getEnabledProviders()).length > 0;
}

// The library allowlist for a provider, or null when it should sync every TV + movie library.
export function libraryAllowlist(config: MediaServerConfig): Set<string> | null {
  const names = config.libraries
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}
