// Public surface of the OMDb integration layer — the source of IMDb community ratings. Import from "@/lib/omdb".
export { OmdbClient, OmdbError, getOmdb, isOmdbConfigured } from "./client";
export * from "./schemas";
