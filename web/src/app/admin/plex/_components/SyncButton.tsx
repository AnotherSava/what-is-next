"use client";

import { useState, useTransition } from "react";
import { syncPlexNow } from "../actions";

// Triggers a full Plex scan (presence + candidate refresh). useTransition keeps it responsive during the
// round-trip to Plex + TMDB.
export function SyncPlexButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await syncPlexNow();
          setDone(true);
        })
      }
      className="rounded-md bg-[#e5a00d] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Syncing…" : done ? "Synced ✓ — sync again" : "Sync Plex now"}
    </button>
  );
}
