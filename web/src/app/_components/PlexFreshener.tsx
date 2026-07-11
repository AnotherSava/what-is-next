"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { freshenPlexOnView } from "../_actions/plex";

// Stale-while-revalidate for Plex watch state — mounted in the root layout for owner sessions only. The page has
// already painted from the DB; after hydration this asks the server to sync Plex if the data is past its window,
// then refreshes the current route in place. It re-checks on mount, on tab-focus, and on a short interval while
// the tab is open, so opening a page re-syncs immediately when it's fallen behind and an open page stays fresh and
// self-heals. The server throttles the actual Plex sync to the window, so most of these calls are ~1 ms no-ops.
// Poll faster than the window so the data never ages past the header dot's green line between syncs.
const POLL_MS = 20_000;

export function PlexFreshener() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    const freshen = async () => {
      if (running.current) return; // one in-flight call per tab; the server coalesces across tabs
      running.current = true;
      try {
        const { synced } = await freshenPlexOnView();
        // Refresh whenever a sync actually ran — not only when data changed — so a "checked, still current" sync
        // resets the freshness dot to green. An unchanged re-render reconciles to the same tree (no visible churn).
        if (synced) router.refresh();
      } catch {
        // never surface a freshen failure — the page keeps showing last-known data
      } finally {
        running.current = false;
      }
    };
    const freshenIfVisible = () => {
      if (document.visibilityState === "visible") void freshen();
    };
    freshenIfVisible(); // on mount / full load (skips a tab opened in the background)
    const poll = setInterval(freshenIfVisible, POLL_MS); // keep an open tab fresh; skip hidden tabs (pointless)
    document.addEventListener("visibilitychange", freshenIfVisible); // returning to the tab after watching
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", freshenIfVisible);
    };
  }, [router]);

  return null;
}
