"use client";

import { useState, useTransition } from "react";
import { backupNow, refreshNow } from "../actions";

// Small owner-console action buttons. useTransition disables the button and shows progress while the (possibly
// slow) refresh/backup runs; a one-line result is shown afterwards.

export function RefreshNowButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <ActionButton
      label="Refresh now"
      pendingLabel="Refreshing…"
      pending={pending}
      done={done}
      onClick={() =>
        start(async () => {
          await refreshNow();
          setDone(true);
        })
      }
    />
  );
}

export function BackupNowButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <ActionButton
      label="Back up now"
      pendingLabel="Backing up…"
      pending={pending}
      done={done}
      onClick={() =>
        start(async () => {
          await backupNow();
          setDone(true);
        })
      }
    />
  );
}

function ActionButton({
  label,
  pendingLabel,
  pending,
  done,
  onClick,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="rounded-md bg-[var(--color-accent-strong)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent)] disabled:opacity-50"
    >
      {pending ? pendingLabel : done ? "Done ✓ — run again" : label}
    </button>
  );
}
