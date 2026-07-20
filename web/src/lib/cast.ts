import { z } from "zod";

// Top-billed movie cast, persisted as a JSON string on MediaItem.cast and rendered on the movie detail page.
// Captured from TMDB credits during hydration (see catalog.ts castFrom); TV rows leave it null.

export interface CastMember {
  name: string;
  character: string | null; // the role, when TMDB lists one
  profilePath: string | null; // TMDB profile-image path (or a full URL); null → no photo
}

const castSchema = z.array(
  z.object({
    name: z.string(),
    character: z.string().nullish(),
    profilePath: z.string().nullish(),
  }),
);

// Parse the stored cast JSON into a typed list. Tolerant by design: a null, blank, or malformed value yields []
// (the detail page then simply hides its cast section) so one bad row can never break the page.
export function parseCast(json: string | null | undefined): CastMember[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const parsed = castSchema.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.map((c) => ({ name: c.name, character: c.character ?? null, profilePath: c.profilePath ?? null }));
}
