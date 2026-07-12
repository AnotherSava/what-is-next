"use client";

import { useState, useTransition } from "react";
import { syncPlexNow } from "../actions";
import { ACTION_BUTTON_CLASS } from "./buttonStyle";

// Triggers a full Plex scan (presence + candidate/unmatched refresh). useTransition keeps it responsive during
// the round-trip to Plex + TMDB.
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
      className={ACTION_BUTTON_CLASS}
    >
      {pending ? "Syncing…" : done ? "Synced ✓ — sync again" : "Sync Plex now"}
    </button>
  );
}
