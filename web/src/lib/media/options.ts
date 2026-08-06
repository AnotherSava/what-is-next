import { JellyfinClient } from "@/lib/jellyfin";
import { PlexClient } from "@/lib/plex";
import type { MediaServerConfig } from "./config";
import type { MediaProvider } from "./types";

// What a connected server can offer the Settings screen: the libraries it actually holds, and (Jellyfin) the
// accounts it can read watch state from. Both used to be free-text fields, where a typo produced a silent
// mismatch — a misspelled library name syncs nothing and quietly empties presence; a misspelled account name
// fails the sync outright. Asking the server removes the class of mistake entirely.

export interface LibraryOption {
  name: string; // matched against the allowlist, so this is exactly the string the scanner compares
  kind: "tv" | "movie";
}

export interface AccountOption {
  name: string;
  hidden: boolean; // kept off the server's login screen, or disabled — the picker hides these
  movies: number; // played counts, so the account you actually watch on is obvious
  episodes: number;
}

export interface ConnectionOptions {
  libraries: LibraryOption[];
  accounts: AccountOption[]; // empty for Plex, whose token is already account-scoped
}

// Ask a server what it offers. Throws if it can't be reached — the caller turns that into "keep the plain text
// inputs", so the screen degrades to editable-by-hand rather than becoming unusable.
export async function fetchConnectionOptions(
  provider: MediaProvider,
  config: MediaServerConfig,
): Promise<ConnectionOptions> {
  if (provider === "plex") {
    const sections = await new PlexClient({ url: config.url, token: config.token }).getSections();
    return {
      libraries: sections.map((s) => ({ name: s.title, kind: s.type === "show" ? "tv" : "movie" })),
      accounts: [],
    };
  }

  const jellyfin = new JellyfinClient({ url: config.url, token: config.token, user: config.user });
  const accounts = await jellyfin.listAccounts();
  // Libraries are listed as a specific account, and the one being configured may not be chosen yet — fall back to
  // any account so the library list still loads (they're the same views either way).
  const asUser = accounts.find((a) => a.name.toLowerCase() === config.user.trim().toLowerCase()) ?? accounts[0];
  const views = asUser ? await jellyfin.getLibraries(asUser.id) : [];
  return {
    libraries: views.map((v) => ({ name: v.Name, kind: v.CollectionType === "tvshows" ? "tv" : "movie" })),
    accounts: accounts.map(({ name, hidden, movies, episodes }) => ({ name, hidden, movies, episodes })),
  };
}

// The allowlist is stored as the comma-separated string the scanners parse; these two keep the checkbox UI and
// that string in step, in one place, so the parse and the format can't drift apart.
export function parseLibraryList(stored: string): string[] {
  return stored
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatLibraryList(names: string[]): string {
  return names.join(", ");
}
