import { JsonClient, MediaServerError } from "@/lib/media/client";
import {
  itemsResponseSchema,
  systemInfoSchema,
  userViewsSchema,
  usersSchema,
  type JellyfinItem,
  type JellyfinView,
} from "./schemas";

// One account on the Jellyfin server, as the settings UI's account picker needs it.
export interface JellyfinAccount {
  id: string;
  name: string;
  hidden: boolean; // kept off the login screen (or disabled) — the picker leaves these out
  movies: number; // played counts, so an account with real history is distinguishable from an empty one
  episodes: number;
}

// Read-only Jellyfin client. Authenticates with an API key (Dashboard → API Keys) via the X-Emby-Token header and
// validates every response with zod (transport + timeout come from the shared JsonClient). NEVER writes to
// Jellyfin — no play state is ever pushed back.
//
// Jellyfin's item queries are per user (watch state belongs to an account), so most calls need a user id; the
// configured account name is resolved to one on first use and cached for the life of the client.

const DEFAULT_JELLYFIN_URL = "http://localhost:8096";
const PAGE_LIMIT = 5000;

export interface JellyfinClientOptions {
  url?: string;
  token: string;
  user?: string; // account name whose watch state to read; blank = the server's first account
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class JellyfinClient {
  private readonly http: JsonClient;
  private readonly userName: string;
  private userIdPromise: Promise<string> | undefined;

  constructor(opts: JellyfinClientOptions) {
    this.http = new JsonClient({
      provider: "jellyfin",
      baseUrl: opts.url?.trim() || DEFAULT_JELLYFIN_URL,
      headers: { "X-Emby-Token": opts.token },
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    this.userName = opts.user?.trim() ?? "";
  }

  // The server's stable id — used with the item id to build a Jellyfin web deep link.
  async getServerId(): Promise<string> {
    return (await this.http.get("/System/Info", systemInfoSchema)).Id;
  }

  // The account whose watch state this sync reads. Resolved once per client. Watch state belongs to an account,
  // so on a multi-account server an unset name is an error rather than a guess — importing the wrong account's
  // history (or none at all) would look like a working sync while quietly being wrong.
  async getUserId(): Promise<string> {
    this.userIdPromise ??= (async () => {
      const users = await this.http.get("/Users", usersSchema);
      if (users.length === 0) throw new MediaServerError("Jellyfin has no user accounts.", "jellyfin");
      if (!this.userName) {
        if (users.length === 1) return users[0].Id;
        throw new MediaServerError(
          `Jellyfin has ${users.length} accounts (${users.map((u) => u.Name).join(", ")}) — set which one to read in Settings.`,
          "jellyfin",
        );
      }
      const match = users.find((u) => u.Name.toLowerCase() === this.userName.toLowerCase());
      if (!match)
        throw new MediaServerError(
          `Jellyfin has no user "${this.userName}" (found: ${users.map((u) => u.Name).join(", ")}).`,
          "jellyfin",
        );
      return match.Id;
    })();
    return this.userIdPromise;
  }

  // Every account on the server, with how much each has actually watched. That activity is what tells one account
  // apart from another when picking which to read — an untouched admin account and the one you really watch on are
  // otherwise just two names. Needs no account of its own, so it works before one has been chosen.
  async listAccounts(): Promise<JellyfinAccount[]> {
    const users = await this.http.get("/Users", usersSchema);
    return Promise.all(
      users.map(async (u) => ({
        id: u.Id,
        name: u.Name,
        hidden: u.Policy?.IsHidden === true || u.Policy?.IsDisabled === true,
        ...(await this.playedCounts(u.Id)),
      })),
    );
  }

  // How many movies and episodes an account has marked played. Asks for a single item and reads the total, so the
  // server counts rather than sending the library.
  private async playedCounts(userId: string): Promise<{ movies: number; episodes: number }> {
    const count = async (kind: "Movie" | "Episode") => {
      const data = await this.http.get(
        `/Items?userId=${encodeURIComponent(userId)}&recursive=true&includeItemTypes=${kind}` +
          `&filters=IsPlayed&enableImages=false&limit=1`,
        itemsResponseSchema,
      );
      return data.TotalRecordCount ?? 0;
    };
    const [movies, episodes] = await Promise.all([count("Movie"), count("Episode")]);
    return { movies, episodes };
  }

  // The user's TV + movie libraries (ignores music/photo/book collections). `asUserId` lets the settings UI list
  // libraries before an account has been chosen, which getUserId would otherwise refuse to do on a multi-account
  // server — a deadlock, since choosing is exactly what that screen is for.
  async getLibraries(asUserId?: string): Promise<JellyfinView[]> {
    const userId = asUserId ?? (await this.getUserId());
    const data = await this.http.get(`/UserViews?userId=${encodeURIComponent(userId)}`, userViewsSchema);
    return data.Items.filter((v) => v.CollectionType === "movies" || v.CollectionType === "tvshows");
  }

  // Every Movie or Series in one library, with external ids + watch state. Movies additionally carry their
  // MediaSources (so a movie's resolution/HDR/audio/subtitles need no follow-up request), and Series carry the two
  // counts the sync's cursors are built from.
  async getLibraryItems(libraryId: string, kind: "Movie" | "Series"): Promise<JellyfinItem[]> {
    const userId = await this.getUserId();
    const fields = kind === "Movie" ? "ProviderIds,MediaSources" : "ProviderIds,RecursiveItemCount,ChildCount";
    const data = await this.http.get(
      `/Items?userId=${encodeURIComponent(userId)}&parentId=${encodeURIComponent(libraryId)}` +
        `&recursive=true&includeItemTypes=${kind}&fields=${fields}` +
        `&enableUserData=true&enableImages=false&limit=${PAGE_LIMIT}`,
      itemsResponseSchema,
    );
    return data.Items;
  }

  // A show's seasons (IndexNumber = season number).
  async getSeasons(seriesId: string): Promise<JellyfinItem[]> {
    const userId = await this.getUserId();
    const data = await this.http.get(
      `/Shows/${encodeURIComponent(seriesId)}/Seasons?userId=${encodeURIComponent(userId)}` +
        `&enableUserData=true&enableImages=false`,
      itemsResponseSchema,
    );
    return data.Items;
  }

  // Every episode of a show with its watch state AND its streams (ParentIndexNumber = season, IndexNumber =
  // episode). Unlike Plex, one request carries the full stream detail, so per-season source needs no extra fetch.
  async getEpisodes(seriesId: string): Promise<JellyfinItem[]> {
    const userId = await this.getUserId();
    const data = await this.http.get(
      `/Shows/${encodeURIComponent(seriesId)}/Episodes?userId=${encodeURIComponent(userId)}` +
        `&fields=MediaSources&enableUserData=true&enableImages=false&limit=${PAGE_LIMIT}`,
      itemsResponseSchema,
    );
    return data.Items;
  }
}
