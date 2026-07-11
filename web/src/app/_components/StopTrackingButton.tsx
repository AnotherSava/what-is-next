"use client";

import { useState, useTransition } from "react";

// Inline two-step "stop tracking" control: an ✕ that, on click, expands into a "Stop tracking? ✓ ✕" confirm before
// running the caller's untrack action — no native dialog. Shared by shows (flip the intent flag) and movies (delete
// the state row); the parent supplies onConfirm already bound to the right item and action.
export function StopTrackingButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        aria-label="Stop tracking"
        title="Stop tracking"
        onClick={() => setConfirming(true)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]"
      >
        ✕
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-[var(--color-muted)]">Stop tracking?</span>
      <button
        type="button"
        disabled={pending}
        aria-label="Confirm stop tracking"
        onClick={() => start(() => onConfirm())}
        className="rounded-md bg-[var(--color-bad)] px-2 py-0.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        disabled={pending}
        aria-label="Cancel"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
      >
        ✕
      </button>
    </span>
  );
}
