"use client";

import Image from "next/image";
import { useState } from "react";

// Round cast portrait with a graceful fallback: it shows the person's initials when there's no photo OR the photo
// fails to load — a stale TMDB path or a CDN blip would otherwise leave a broken-image glyph, since we hotlink
// image.tmdb.org directly (next.config `unoptimized`). Client component because `onError` only fires in the browser.
// `size` is the diameter in px (default 72, the movie/show "Top cast" grid; the show page's right rail uses 52).
export function CastAvatar({ name, photo, size = 72 }: { name: string; photo: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const dims = { width: size, height: size, borderColor: "var(--color-border-elevated)" } as const;
  if (photo && !broken) {
    return (
      <Image
        src={photo}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full border object-cover"
        style={dims}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="font-display flex shrink-0 items-center justify-center rounded-full border bg-[var(--color-surface-2)] font-semibold text-[var(--color-muted)]"
      style={{ ...dims, fontSize: size >= 64 ? 16 : 13 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
