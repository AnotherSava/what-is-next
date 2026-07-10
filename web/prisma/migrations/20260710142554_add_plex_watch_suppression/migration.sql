-- CreateTable
CREATE TABLE "PlexWatchSuppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "episodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlexWatchSuppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlexWatchSuppression_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlexWatchSuppression_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlexWatchSuppression_userId_mediaItemId_idx" ON "PlexWatchSuppression"("userId", "mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PlexWatchSuppression_userId_mediaItemId_episodeId_key" ON "PlexWatchSuppression"("userId", "mediaItemId", "episodeId");
