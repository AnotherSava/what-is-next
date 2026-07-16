"use client";

import { useState, useTransition } from "react";
import { syncPlexNow } from "../actions";
import { JOB_BUTTON_CLASS, JOB_BUTTON_STYLE } from "./buttonStyle";

// Triggers a full Plex scan (presence + candidate/unmatched refresh). useTransition keeps it responsive during
// the round-trip to Plex + TMDB.
export function SyncPlexButton({ dotColor }: { dotColor: string }) {
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
      className={JOB_BUTTON_CLASS}
      style={JOB_BUTTON_STYLE}
    >
      <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden />
      {pending ? "Syncing…" : done ? "Synced ✓ — sync again" : "Sync Plex now"}
    </button>
  );
}
