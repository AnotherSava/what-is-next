"use client";

import Image from "next/image";
import { useState } from "react";

// Round cast portrait with a graceful fallback: it shows the person's initials when there's no photo OR the photo
// fails to load — a stale TMDB path or a CDN blip would otherwise leave a broken-image glyph, since we hotlink
// image.tmdb.org directly (next.config `unoptimized`). Client component because `onError` only fires in the browser.
export function CastAvatar({ name, photo }: { name: string; photo: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <Image
        src={photo}
        alt={name}
        width={72}
        height={72}
        className="h-[72px] w-[72px] shrink-0 rounded-full border object-cover"
        style={{ borderColor: "var(--color-border-elevated)" }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="font-display flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border bg-[var(--color-surface-2)] text-[16px] font-semibold text-[var(--color-muted)]"
      style={{ borderColor: "var(--color-border-elevated)" }}
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
