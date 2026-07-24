import type { ReactNode } from "react";
import Image from "next/image";
import { RatingBadge } from "./cardUi";
import { posterUrl } from "@/lib/images";

// The hero poster for a non-library preview page (movie or show). Same frame as the real detail heroes
// (MovieHeroPoster / ShowHeroPoster) — rounded, bordered, drop-shadowed 2:3 — but inert: no Plex play overlay,
// watched stamp, or progress bar, since none of that state exists for an item that isn't in the library. Overlays
// the TMDB ★ rating chip (there's no IMDb rating without a catalog row) and, top-right, whatever `children` the
// caller drops in — the "+" add mark, mirroring where a library poster shows its favourite heart.
export function PreviewHeroPoster({
  title,
  posterPath,
  rating,
  children,
}: {
  title: string;
  posterPath: string | null;
  rating: number | null; // TMDB community score (0–10); null hides the chip
  children?: ReactNode; // top-right corner overlay (the add "+" mark)
}) {
  const url = posterUrl(posterPath, "w342");

  return (
    <div
      className="relative aspect-[2/3] w-[180px] shrink-0 self-start overflow-hidden rounded-[14px] border sm:w-[240px]"
      style={{ borderColor: "var(--color-border-elevated)", boxShadow: "0 26px 60px -22px rgba(0,0,0,0.92)" }}
    >
      {url ? (
        <Image src={url} alt={title} fill sizes="(max-width: 640px) 180px, 240px" className="object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-2)] p-3 text-center text-[12px] leading-tight text-[var(--color-muted)]">
          {title}
        </div>
      )}

      {rating != null && <RatingBadge value={rating} className="absolute top-[10px] left-[10px] z-[3]" />}

      {children}
    </div>
  );
}
