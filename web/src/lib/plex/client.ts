import type { z } from "zod";
import {
  plexEpisodesResponseSchema,
  plexIdentitySchema,
  plexItemsResponseSchema,
  plexSeasonsResponseSchema,
  plexSectionsResponseSchema,
  type PlexEpisode,
  type PlexItem,
  type PlexSeason,
  type PlexSection,
} from "./schemas";

// Read-only Plex Media Server client (Plex integration). Talks to the local/remote server over HTTP with an
// X-Plex-Token header and validates every response with zod. NEVER writes to Plex. fetch is injectable for
// tests. The whole Plex feature is gated on PLEX_TOKEN being set (isPlexConfigured).

const DEFAULT_PLEX_URL = "http://localhost:32400";

export class PlexError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlexError";
  }
}

export function isPlexConfigured(): boolean {
  return Boolean(process.env.PLEX_TOKEN);
}

export interface PlexClientOptions {
  url?: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PlexClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PlexClientOptions) {
    this.baseUrl = (opts.url ?? DEFAULT_PLEX_URL).replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  // The server's stable machineIdentifier — used to build app.plex.tv deep links to watch an item.
  async getMachineIdentifier(): Promise<string> {
    const data = await this.get("/identity", plexIdentitySchema);
    return data.MediaContainer.machineIdentifier;
  }

  // The TV + movie libraries (ignores music/photo sections).
  async getSections(): Promise<PlexSection[]> {
    const data = await this.get("/library/sections", plexSectionsResponseSchema);
    return data.MediaContainer.Directory.filter((s) => s.type === "show" || s.type === "movie");
  }

  // All items (shows or movies) in a library, with external ids + watch state.
  async getSectionItems(sectionKey: string): Promise<PlexItem[]> {
    const data = await this.get(
      `/library/sections/${encodeURIComponent(sectionKey)}/all?includeGuids=1&X-Plex-Container-Size=5000`,
      plexItemsResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }

  // A show's seasons (index = season number, leafCount/viewedLeafCount = episode totals).
  async getShowSeasons(ratingKey: string): Promise<PlexSeason[]> {
    const data = await this.get(
      `/library/metadata/${encodeURIComponent(ratingKey)}/children`,
      plexSeasonsResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }

  // Every episode of a show with its watch state (parentIndex = season, index = episode, viewCount>0 = watched).
  async getShowEpisodes(ratingKey: string): Promise<PlexEpisode[]> {
    const data = await this.get(
      `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`,
      plexEpisodesResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json", "X-Plex-Token": this.token },
        signal: controller.signal,
      });
    } catch (err) {
      throw new PlexError(`Plex request failed: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new PlexError(`Plex ${res.status} on ${path}`, res.status);
    return schema.parse(await res.json());
  }
}

// App singleton — reads PLEX_URL + PLEX_TOKEN from env. Throws if the token is unset (guard with isPlexConfigured).
let singleton: PlexClient | undefined;
export function getPlex(): PlexClient {
  if (!singleton) {
    const token = process.env.PLEX_TOKEN;
    if (!token) throw new Error("PLEX_TOKEN is not set");
    singleton = new PlexClient({ url: process.env.PLEX_URL, token });
  }
  return singleton;
}
