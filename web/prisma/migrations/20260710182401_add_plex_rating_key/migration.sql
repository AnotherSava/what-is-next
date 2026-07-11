-- Store the Plex ratingKey of each present item (the show/movie) so the app can deep-link into Plex to watch it.
-- Nullable + additive: existing rows stay null until the next sync back-fills them.
-- AlterTable
ALTER TABLE "PlexPresence" ADD COLUMN "plexRatingKey" TEXT;
