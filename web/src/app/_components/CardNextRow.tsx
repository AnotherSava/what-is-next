"use client";

import { useEffect, useRef, useState } from "react";

// The "next up" row on a show card: an amber episode code, an optional episode title (narrow), and an optional
// "+N more" pinned right. When the title is too long to fit alongside the full "+N more", this drops the suffix to
// a bare "+N" for that card, handing the freed width back to the title. The decision is measured per card against
// the *full* "+N more" width (a hidden probe), so shortening can't itself change the verdict and oscillate.
export function CardNextRow({
  code,
  epTitle,
  moreCount,
}: {
  code: string;
  epTitle?: string | null;
  moreCount?: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [tight, setTight] = useState(false);
  const hasMore = moreCount != null && moreCount > 0;

  useEffect(() => {
    if (!hasMore) return;
    const measure = () => {
      const row = rowRef.current;
      const left = leftRef.current;
      const probe = probeRef.current;
      if (!row || !left || !probe) return;
      const GAP = 8; // gap-2 between the title and the "+N more" column
      const avail = row.clientWidth - GAP - probe.offsetWidth; // room the title gets when the full "+N more" shows
      setTight(left.scrollWidth > avail + 0.5);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rowRef.current!);
    return () => ro.disconnect();
  }, [code, epTitle, moreCount, hasMore]);

  return (
    <div ref={rowRef} className="relative mt-[3px] flex items-baseline justify-between gap-2">
      <span ref={leftRef} className="min-w-0 truncate">
        <span className="font-num text-[11px] tabular-nums text-[var(--color-behind)]">{code}</span>
        {epTitle && <span className="font-narrow ml-[9px] text-[13px] text-[var(--color-bright)]">{epTitle}</span>}
      </span>
      {hasMore && (
        <span className="shrink-0 whitespace-nowrap font-num text-[11px] tabular-nums text-[var(--color-faint)]">
          +{moreCount}
          {!tight && " more"}
        </span>
      )}
      {hasMore && (
        <span
          ref={probeRef}
          aria-hidden
          className="pointer-events-none invisible absolute whitespace-nowrap font-num text-[11px] tabular-nums"
        >
          +{moreCount} more
        </span>
      )}
    </div>
  );
}
