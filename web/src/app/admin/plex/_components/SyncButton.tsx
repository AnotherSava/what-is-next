"use client";

import { useState, useTransition } from "react";
import { ACTION_BUTTON_CLASS } from "../../_components/buttonStyle";
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
      className={ACTION_BUTTON_CLASS}
    >
      {pending ? "Syncing…" : done ? "Synced ✓ — sync again" : "Sync Plex now"}
    </button>
  );
}
