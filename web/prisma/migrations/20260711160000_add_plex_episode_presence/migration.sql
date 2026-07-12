-- CreateTable
CREATE TABLE "PlexEpisodePresence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlexEpisodePresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlexEpisodePresence_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlexEpisodePresence_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlexEpisodePresence_userId_mediaItemId_idx" ON "PlexEpisodePresence"("userId", "mediaItemId");

-- CreateIndex
CREATE INDEX "PlexEpisodePresence_userId_idx" ON "PlexEpisodePresence"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlexEpisodePresence_userId_episodeId_key" ON "PlexEpisodePresence"("userId", "episodeId");
