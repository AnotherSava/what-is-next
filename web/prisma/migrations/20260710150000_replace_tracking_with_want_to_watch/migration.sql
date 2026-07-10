-- Replace the 4-value `tracking` enum with a single `wantToWatch` boolean. Every display state
-- (planned/behind/up-to-date/stopped/finished) is now DERIVED from the watch log + airing status; the only
-- stored intent is "on my list / want to watch". Data mapping: stopped → false (dropped), everything else
-- (planned/watching/finished) → true (you wanted it). A show that was `stopped` with nothing watched becomes
-- off-list (want=false + 0 watched) and is no longer displayed — a deliberate consequence of the new model.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserMediaState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "wantToWatch" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMediaState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserMediaState_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserMediaState" ("createdAt", "id", "isFavorite", "mediaItemId", "updatedAt", "userId", "wantToWatch")
SELECT "createdAt", "id", "isFavorite", "mediaItemId", "updatedAt", "userId",
    CASE WHEN "tracking" = 'stopped' THEN false ELSE true END
FROM "UserMediaState";
DROP TABLE "UserMediaState";
ALTER TABLE "new_UserMediaState" RENAME TO "UserMediaState";
CREATE UNIQUE INDEX "UserMediaState_userId_mediaItemId_key" ON "UserMediaState"("userId", "mediaItemId");
CREATE INDEX "UserMediaState_userId_wantToWatch_idx" ON "UserMediaState"("userId", "wantToWatch");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
