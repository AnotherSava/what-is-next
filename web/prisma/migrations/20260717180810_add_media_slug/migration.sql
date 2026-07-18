-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_slug_mediaType_key" ON "MediaItem"("slug", "mediaType");
