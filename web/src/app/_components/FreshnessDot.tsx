"use client";

import { useEffect, useState } from "react";

// Freshness of the Plex-synced watch data the page is showing, driven by the last sync time:
//   • green  — synced within the last 1.5 min (up to date; an open tab re-syncs ~every minute, so it stays green)
//   • yellow — older than that
//   • red    — older than the stale threshold (3× the general sync window; genuinely behind)
// It ticks on its own so the colour ages while the page sits open between syncs; a real sync re-renders this with
// a newer lastSyncAt (via the freshener's router.refresh) and it returns to green.

const FRESH_MAX_MS = 90_000; // ≤ 1.5 min → green
const TICK_MS = 15_000; // re-evaluate the colour as the data ages
const OPTIMISTIC_MS = 3_000; // a freshen always fires on load — hold green this long so we don't flash stale→green

type Freshness = "fresh" | "aging" | "stale";

function freshnessOf(ageMs: number, staleThresholdMs: number): Freshness {
  if (ageMs <= FRESH_MAX_MS) return "fresh";
  if (ageMs <= staleThresholdMs) return "aging";
  return "stale";
}

const COLOR: Record<Freshness, string> = {
  fresh: "var(--color-good)",
  aging: "var(--color-behind)",
  stale: "var(--color-bad)",
};

const TITLE: Record<Freshness, string> = {
  fresh: "Up to date — recently synced",
  aging: "Synced a few minutes ago",
  stale: "Stale — no Plex sync in a while",
};

export function FreshnessDot({ lastSyncAt, staleThresholdMs }: { lastSyncAt: string; staleThresholdMs: number }) {
  const lastSyncMs = Date.parse(lastSyncAt);
  // Start from the sync instant (age 0 → green) so SSR and the first client render agree; the effect then advances
  // to the real clock and keeps it current.
  const [nowMs, setNowMs] = useState(lastSyncMs);
  // Hold green until the on-mount freshen has had time to land, so opening a page that was briefly behind shows
  // green rather than flashing yellow→green when the sync completes. Only reveals a stale colour if it can't.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    update();
    const tick = setInterval(update, TICK_MS);
    const settle = setTimeout(() => setSettled(true), OPTIMISTIC_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(settle);
    };
  }, []);

  const freshness = settled ? freshnessOf(nowMs - lastSyncMs, staleThresholdMs) : "fresh";
  return (
    <span
      role="img"
      aria-label={TITLE[freshness]}
      title={TITLE[freshness]}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: COLOR[freshness] }}
    />
  );
}
