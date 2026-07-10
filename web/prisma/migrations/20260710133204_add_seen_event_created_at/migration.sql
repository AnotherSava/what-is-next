-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SeenEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "episodeId" TEXT,
    "watchedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'app',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeenEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeenEvent_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeenEvent_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SeenEvent" ("episodeId", "id", "mediaItemId", "source", "userId", "watchedAt") SELECT "episodeId", "id", "mediaItemId", "source", "userId", "watchedAt" FROM "SeenEvent";
DROP TABLE "SeenEvent";
ALTER TABLE "new_SeenEvent" RENAME TO "SeenEvent";
CREATE INDEX "SeenEvent_userId_mediaItemId_idx" ON "SeenEvent"("userId", "mediaItemId");
CREATE INDEX "SeenEvent_episodeId_idx" ON "SeenEvent"("episodeId");
CREATE INDEX "SeenEvent_userId_createdAt_idx" ON "SeenEvent"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
