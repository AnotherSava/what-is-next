-- AlterTable
ALTER TABLE "Season" ADD COLUMN "tvdbId" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MediaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaType" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "imdbId" TEXT,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "overview" TEXT,
    "releaseDate" TEXT,
    "status" TEXT,
    "runtime" INTEGER,
    "posterPath" TEXT,
    "backdropPath" TEXT,
    "genres" TEXT,
    "tmdbRating" REAL,
    "numberOfSeasons" INTEGER,
    "numberOfEpisodes" INTEGER,
    "lastRefreshedAt" DATETIME,
    "needsDetails" BOOLEAN NOT NULL DEFAULT true,
    "metadataSource" TEXT NOT NULL DEFAULT 'tmdb',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_MediaItem" ("backdropPath", "createdAt", "genres", "id", "imdbId", "lastRefreshedAt", "mediaType", "needsDetails", "numberOfEpisodes", "numberOfSeasons", "originalTitle", "overview", "posterPath", "releaseDate", "runtime", "status", "title", "tmdbId", "tmdbRating", "tvdbId", "updatedAt") SELECT "backdropPath", "createdAt", "genres", "id", "imdbId", "lastRefreshedAt", "mediaType", "needsDetails", "numberOfEpisodes", "numberOfSeasons", "originalTitle", "overview", "posterPath", "releaseDate", "runtime", "status", "title", "tmdbId", "tmdbRating", "tvdbId", "updatedAt" FROM "MediaItem";
DROP TABLE "MediaItem";
ALTER TABLE "new_MediaItem" RENAME TO "MediaItem";
CREATE INDEX "MediaItem_mediaType_idx" ON "MediaItem"("mediaType");
CREATE UNIQUE INDEX "MediaItem_tvdbId_mediaType_key" ON "MediaItem"("tvdbId", "mediaType");
CREATE UNIQUE INDEX "MediaItem_tmdbId_mediaType_key" ON "MediaItem"("tmdbId", "mediaType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
