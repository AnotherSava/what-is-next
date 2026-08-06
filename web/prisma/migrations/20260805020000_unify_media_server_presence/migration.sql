-- Generalize the Plex-only presence tables into provider-neutral media-server tables, so Plex and Jellyfin can
-- both be connected at once. Table + column renames preserve existing rows; the new `provider` column defaults to
-- 'plex', which is exactly what every pre-existing row is.
--
-- Hand-authored (prisma migrate dev is non-interactive here — see CLAUDE.md). SQLite keeps a renamed table's
-- indexes but not their names, so each index is dropped and recreated under the name Prisma expects.

-- ── PlexPresence → MediaPresence ──────────────────────────────────────────
DROP INDEX "PlexPresence_userId_mediaItemId_idx";
DROP INDEX "PlexPresence_userId_idx";
ALTER TABLE "PlexPresence" RENAME TO "MediaPresence";
ALTER TABLE "MediaPresence" RENAME COLUMN "plexRatingKey" TO "itemKey";
ALTER TABLE "MediaPresence" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'plex';
CREATE INDEX "MediaPresence_userId_mediaItemId_idx" ON "MediaPresence"("userId", "mediaItemId");
CREATE INDEX "MediaPresence_userId_provider_idx" ON "MediaPresence"("userId", "provider");

-- ── PlexEpisodePresence → MediaEpisodePresence ────────────────────────────
-- The uniqueness key gains `provider`: the same episode can legitimately be present on both servers.
DROP INDEX "PlexEpisodePresence_userId_mediaItemId_idx";
DROP INDEX "PlexEpisodePresence_userId_idx";
DROP INDEX "PlexEpisodePresence_userId_episodeId_key";
ALTER TABLE "PlexEpisodePresence" RENAME TO "MediaEpisodePresence";
ALTER TABLE "MediaEpisodePresence" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'plex';
CREATE UNIQUE INDEX "MediaEpisodePresence_userId_provider_episodeId_key" ON "MediaEpisodePresence"("userId", "provider", "episodeId");
CREATE INDEX "MediaEpisodePresence_userId_mediaItemId_idx" ON "MediaEpisodePresence"("userId", "mediaItemId");
CREATE INDEX "MediaEpisodePresence_userId_provider_idx" ON "MediaEpisodePresence"("userId", "provider");

-- ── PlexWatchSuppression → WatchSuppression ───────────────────────────────
-- No provider column: an in-app "unwatch" means "I have not watched this" and must hold against every server.
DROP INDEX "PlexWatchSuppression_userId_mediaItemId_idx";
DROP INDEX "PlexWatchSuppression_userId_mediaItemId_episodeId_key";
ALTER TABLE "PlexWatchSuppression" RENAME TO "WatchSuppression";
CREATE UNIQUE INDEX "WatchSuppression_userId_mediaItemId_episodeId_key" ON "WatchSuppression"("userId", "mediaItemId", "episodeId");
CREATE INDEX "WatchSuppression_userId_mediaItemId_idx" ON "WatchSuppression"("userId", "mediaItemId");

-- ── Reshaped Setting rows ─────────────────────────────────────────────────
-- These three stored values change shape (plexRatingKey → itemKey, lastViewedAt epoch → ISO watchedAt,
-- machineIdentifier → serverId). getSetting parses strictly, so a stale row would throw; drop them and let the
-- next sync rewrite them. All three are pure caches — nothing user-authored is lost.
DELETE FROM "Setting" WHERE "key" IN ('plex:candidates', 'plex:unaccounted', 'plex:server');
