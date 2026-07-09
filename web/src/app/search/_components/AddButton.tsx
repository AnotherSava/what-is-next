"use client";

import { useState, useTransition } from "react";
import type { SearchResult } from "@/lib/search";
import { addTitle } from "../actions";

// "Add" for a search result → creates the stub + planned state; flips to "Tracked" optimistically.
export function AddButton({ result }: { result: SearchResult }) {
  const [tracked, setTracked] = useState(result.alreadyTracked);
  const [pending, start] = useTransition();

  if (tracked) {
    return (
      <span className="rounded-md bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        Tracked
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await addTitle({
            tmdbId: result.tmdbId,
            mediaType: result.mediaType,
            title: result.title,
            posterPath: result.posterPath,
          });
          setTracked(true);
        })
      }
      className="rounded-md bg-[var(--color-accent-strong)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent)] disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add"}
    </button>
  );
}
