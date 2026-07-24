"use client";

import { useEffect, useRef, useState } from "react";

// A single-line, ellipsized label that surfaces its full text as a native tooltip ONLY when the text is actually
// clipped by its box. Measured on mount and whenever the element resizes (e.g. the grid-density slider changes the
// column width), so a title that fits gets no redundant tooltip while a clipped one is always readable on hover.
// Client because it measures the DOM; it's rendered by the (server-safe) CardTitle, so every poster-grid card gets it.
export function TruncatedTitle({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={ref} title={clipped ? text : undefined} className={className}>
      {text}
    </span>
  );
}
