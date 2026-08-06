import { z } from "zod";

// Zod schemas for the Jellyfin HTTP API responses we consume (brief §2 convention: validate all external JSON).
// Verified against Jellyfin 10.11. Jellyfin returns far more than we read; schemas are permissive and pick only
// what the sync needs, so a server version that adds or drops unrelated fields keeps parsing.

// GET /System/Info → the server's identity. `Id` is the stable server id that a web deep link needs.
export const systemInfoSchema = z.object({ Id: z.string(), ServerName: z.string().nullish() });

// GET /Users → the server's accounts. Watch state is per user, so a sync has to pick one (see the `user` setting).
export const usersSchema = z.array(
  z.object({
    Id: z.string(),
    Name: z.string(),
    // Hidden accounts are kept off the login screen; the account picker filters on this.
    Policy: z.object({ IsHidden: z.boolean().nullish(), IsDisabled: z.boolean().nullish() }).nullish(),
  }),
);

// GET /UserViews?userId= → the user's libraries. CollectionType is "movies" | "tvshows" | "music" | …
export const userViewSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  CollectionType: z.string().nullish(),
});
export type JellyfinView = z.infer<typeof userViewSchema>;
export const userViewsSchema = z.object({ Items: z.array(userViewSchema).default([]) });

// A stream inside a MediaSource. Type is "Video" | "Audio" | "Subtitle" | "EmbeddedImage" | …
// Language is an ISO 639-2 code ("eng" | "rus"), including bibliographic variants ("fre", "ger").
// VideoRangeType carries the HDR flavour: "SDR" | "HDR10" | "HLG" | "DOVI" | "DOVIWithHDR10" | "HDR10Plus" | …
// Atmos shows up in Profile ("Dolby Digital Plus + Dolby Atmos") and in the DisplayTitle.
const mediaStreamSchema = z.object({
  Type: z.string(),
  Language: z.string().nullish(),
  DisplayTitle: z.string().nullish(),
  Title: z.string().nullish(),
  Profile: z.string().nullish(),
  Width: z.number().int().nullish(),
  Height: z.number().int().nullish(),
  VideoRangeType: z.string().nullish(),
});
export type JellyfinStream = z.infer<typeof mediaStreamSchema>;

export const mediaSourceSchema = z.object({ MediaStreams: z.array(mediaStreamSchema).nullish() });
export type JellyfinMediaSource = z.infer<typeof mediaSourceSchema>;

// Per-user state on an item. LastPlayedDate is an ISO timestamp; UnplayedItemCount is only meaningful on folders
// (a Series/Season), where — with RecursiveItemCount — it gives the show's watched-episode count for free.
const userDataSchema = z.object({
  Played: z.boolean().nullish(),
  PlayCount: z.number().int().nullish(),
  LastPlayedDate: z.string().nullish(),
  UnplayedItemCount: z.number().int().nullish(),
});

// External ids, e.g. { "Tmdb": "1399", "Imdb": "tt0944947", "Tvdb": "121361" }. Kept as a loose record because
// plugins add their own keys and casing isn't guaranteed — parseProviderIds normalises it.
const providerIdsSchema = z.record(z.string(), z.string().nullish());

// A library item: a Movie, a Series, a Season or an Episode. One schema covers all four — each shape only fills
// in the fields that apply to it (a Series has RecursiveItemCount, an Episode has ParentIndexNumber, …).
export const itemSchema = z.object({
  Id: z.string(),
  Name: z.string().default(""),
  ProductionYear: z.number().int().nullish(),
  ProviderIds: providerIdsSchema.nullish(),
  UserData: userDataSchema.nullish(),
  MediaSources: z.array(mediaSourceSchema).nullish(),
  IndexNumber: z.number().int().nullish(), // season number (on a Season) / episode number (on an Episode)
  ParentIndexNumber: z.number().int().nullish(), // an Episode's season number
  RecursiveItemCount: z.number().int().nullish(), // a Series' total episode count
  ChildCount: z.number().int().nullish(), // a Series' season count
});
export type JellyfinItem = z.infer<typeof itemSchema>;

// TotalRecordCount is what a "how many match?" query reads — asking for limit=1 and taking the count is far
// cheaper than fetching every item just to length it.
export const itemsResponseSchema = z.object({
  Items: z.array(itemSchema).default([]),
  TotalRecordCount: z.number().int().nullish(),
});

export interface JellyfinExternalIds {
  tmdbId: number | null;
  tvdbId: number | null;
  imdbId: string | null;
}

// Extract tmdb/tvdb/imdb ids from an item's ProviderIds map. Keys are matched case-insensitively because the
// casing Jellyfin writes depends on which metadata plugin populated them.
export function parseProviderIds(item: {
  ProviderIds?: Record<string, string | null | undefined> | null;
}): JellyfinExternalIds {
  const out: JellyfinExternalIds = { tmdbId: null, tvdbId: null, imdbId: null };
  for (const [rawKey, rawValue] of Object.entries(item.ProviderIds ?? {})) {
    const value = (rawValue ?? "").trim();
    if (!value) continue;
    switch (rawKey.toLowerCase()) {
      case "tmdb":
        out.tmdbId = Number(value) || null;
        break;
      case "tvdb":
        out.tvdbId = Number(value) || null;
        break;
      case "imdb":
        out.imdbId = value;
        break;
    }
  }
  return out;
}
