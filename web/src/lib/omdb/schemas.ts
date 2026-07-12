import { z } from "zod";

// Zod schema for the OMDb "by IMDb id" response (GET /?i=tt…). OMDb returns every field as a string and uses the
// literal "N/A" for missing values; we only consume imdbRating. A lookup is either { Response: "True", imdbRating,
// … } or { Response: "False", Error }. Kept permissive (only the fields we read are modelled) so an added OMDb
// field never breaks the parse — matching the TMDB/TVDB schema convention.
export const omdbTitleSchema = z.object({
  Response: z.string(),
  Error: z.string().nullish(),
  Title: z.string().nullish(),
  imdbID: z.string().nullish(),
  imdbRating: z.string().nullish(), // e.g. "8.8", or "N/A" when the title is unrated
});
export type OmdbTitle = z.infer<typeof omdbTitleSchema>;
