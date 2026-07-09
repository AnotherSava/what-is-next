-- CreateTable
CREATE TABLE "PlexPresence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "seasonNumber" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlexPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlexPresence_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlexPresence_userId_mediaItemId_idx" ON "PlexPresence"("userId", "mediaItemId");

-- CreateIndex
CREATE INDEX "PlexPresence_userId_idx" ON "PlexPresence"("userId");
