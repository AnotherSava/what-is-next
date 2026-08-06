import { JsonClient } from "@/lib/media/client";
import {
  plexEpisodesResponseSchema,
  plexIdentitySchema,
  plexItemsResponseSchema,
  plexMetadataDetailResponseSchema,
  plexSeasonsResponseSchema,
  plexSectionsResponseSchema,
  type PlexEpisode,
  type PlexItem,
  type PlexMedia,
  type PlexSeason,
  type PlexSection,
} from "./schemas";

// Read-only Plex Media Server client. Talks to the local/remote server over HTTP with an X-Plex-Token header and
// validates every response with zod (transport + timeout come from the shared JsonClient). NEVER writes to Plex.
// The connection (URL + token) comes from the media-server settings, not the environment — see lib/media/config.

const DEFAULT_PLEX_URL = "http://localhost:32400";

export interface PlexClientOptions {
  url?: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PlexClient {
  private readonly http: JsonClient;

  constructor(opts: PlexClientOptions) {
    this.http = new JsonClient({
      provider: "plex",
      baseUrl: opts.url?.trim() || DEFAULT_PLEX_URL,
      headers: { "X-Plex-Token": opts.token },
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
  }

  // The server's stable machineIdentifier — used to build app.plex.tv deep links to watch an item.
  async getMachineIdentifier(): Promise<string> {
    const data = await this.http.get("/identity", plexIdentitySchema);
    return data.MediaContainer.machineIdentifier;
  }

  // The TV + movie libraries (ignores music/photo sections).
  async getSections(): Promise<PlexSection[]> {
    const data = await this.http.get("/library/sections", plexSectionsResponseSchema);
    return data.MediaContainer.Directory.filter((s) => s.type === "show" || s.type === "movie");
  }

  // All items (shows or movies) in a library, with external ids + watch state.
  async getSectionItems(sectionKey: string): Promise<PlexItem[]> {
    const data = await this.http.get(
      `/library/sections/${encodeURIComponent(sectionKey)}/all?includeGuids=1&X-Plex-Container-Size=5000`,
      plexItemsResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }

  // An item's Media list (versions/files) with per-stream detail — the source of a movie's resolution + HDR. One
  // lightweight metadata call per item, mirroring getShowSeasons for shows (see scan.ts's movie branch).
  async getItemMedia(ratingKey: string): Promise<PlexMedia[]> {
    const data = await this.http.get(
      `/library/metadata/${encodeURIComponent(ratingKey)}`,
      plexMetadataDetailResponseSchema,
    );
    return data.MediaContainer.Metadata[0]?.Media ?? [];
  }

  // A show's seasons (index = season number, leafCount/viewedLeafCount = episode totals).
  async getShowSeasons(ratingKey: string): Promise<PlexSeason[]> {
    const data = await this.http.get(
      `/library/metadata/${encodeURIComponent(ratingKey)}/children`,
      plexSeasonsResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }

  // Every episode of a show with its watch state (parentIndex = season, index = episode, viewCount>0 = watched).
  async getShowEpisodes(ratingKey: string): Promise<PlexEpisode[]> {
    const data = await this.http.get(
      `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`,
      plexEpisodesResponseSchema,
    );
    return data.MediaContainer.Metadata;
  }
}
