import Image from "next/image";
import { posterUrl } from "@/lib/images";

// The fill poster/photo used by every 2:3 grid card — poster grids, search results, and person results. Renders a
// cover image from a TMDB path / TVDB URL, or a titled placeholder when the row has no artwork. One component so
// the placeholder treatment and sizing hints can't drift between the grids. Carries the `.wn-poster` class so the
// shared hover-scale (`.wn-posterwrap:hover .wn-poster`) applies wherever it's used.
export function PosterImage({ path, alt }: { path: string | null; alt: string }) {
  const url = posterUrl(path, "w342");
  if (!url) {
    return (
      <div className="wn-poster absolute inset-0 flex items-center justify-center bg-[var(--color-surface-2)] p-3 text-center text-[11px] leading-tight text-[var(--color-muted)]">
        {alt}
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes="(max-width: 768px) 45vw, 240px"
      className="wn-poster object-cover"
      loading="lazy"
    />
  );
}
