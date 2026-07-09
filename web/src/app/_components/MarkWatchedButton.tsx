"use client";

import { useTransition } from "react";
import { markEpisodeWatched } from "@/app/shows/actions";

// One-tap "mark watched" for a next-up episode (brief §8.1). Owner-only; the action re-verifies the session.
export function MarkWatchedButton({ episodeId, label = "Mark watched" }: { episodeId: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => markEpisodeWatched(episodeId))}
      className="shrink-0 rounded-md bg-[var(--color-good)] px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}
