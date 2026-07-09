import Image from "next/image";
import { posterUrl } from "@/lib/images";

// Poster/backdrop image, hotlinked by path from TMDB or by full URL from TVDB (brief §4). Falls back to a titled
// placeholder when the catalog row has no image (e.g. an unresolved import stub). Images are `unoptimized`.
export function Poster({
  path,
  alt,
  size = "w342",
  width = 120,
  height = 180,
  className = "",
}: {
  path: string | null | undefined;
  alt: string;
  size?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const url = posterUrl(path, size);
  const base = "rounded-lg bg-[var(--color-surface-2)] object-cover";
  if (!url) {
    return (
      <div
        className={`${base} flex items-center justify-center p-2 text-center text-[10px] leading-tight text-[var(--color-muted)] ${className}`}
        style={{ width, height }}
      >
        {alt}
      </div>
    );
  }
  return <Image src={url} alt={alt} width={width} height={height} className={`${base} ${className}`} loading="lazy" />;
}
