// Public surface of the TMDB integration layer (brief §3.2). Import from "@/lib/tmdb", never reach into files.
export { TmdbClient, TmdbError, getTmdb } from "./client";
export { RateLimiter } from "./throttle";
export { tmdbImageUrl } from "./images";
export * from "./schemas";
