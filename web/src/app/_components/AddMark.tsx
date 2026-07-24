"use client";

import { type MouseEvent, useEffect, useState } from "react";

// The "+" add affordance on a poster's top-right corner for an item that isn't in your library — shown on search
// result cards and on the non-library preview hero (where a library poster shows its favourite heart instead). Two-
// step, to guard against an accidental add: the first click ARMS it — the bare "+" EXPANDS into an accent "＋ Add"
// call-to-action pill (a labelled button, so it clearly reads "click here to add" rather than a ✓ that looks already-
// done) — and a second click commits via onConfirm. Clicking anywhere else, pressing Escape, or a short idle timeout
// disarms it back to "+". The button stops event propagation, so a click here never triggers the poster/link behind
// it; `pending` disables it while the add runs.
export function AddMark({
  pending,
  onConfirm,
  title = "Add to your library",
}: {
  pending: boolean;
  onConfirm: () => void;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);

  // While armed, disarm on an idle timeout, a click anywhere else, or Escape. The outside-click listener is attached
  // on the next tick so the very click that armed it can't immediately disarm it.
  useEffect(() => {
    if (!armed) return;
    const idle = setTimeout(() => setArmed(false), 2600);
    const disarm = () => setArmed(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArmed(false); };
    const attach = setTimeout(() => document.addEventListener("click", disarm), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(idle);
      clearTimeout(attach);
      document.removeEventListener("click", disarm);
      document.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onConfirm();
  };

  return (
    <button
      type="button"
      title={armed ? "Click to add to your library" : title}
      aria-label={armed ? "Add to your library" : title}
      disabled={pending}
      onClick={handleClick}
      className={
        armed
          ? "wn-addmark absolute top-[7px] right-[7px] z-[3] inline-flex cursor-pointer items-center gap-1 rounded-full py-[5px] pr-3 pl-2 text-[11.5px] font-bold text-[#0a0a0c] disabled:opacity-60"
          : "wn-addmark absolute top-[8px] right-[8px] z-[3] cursor-pointer leading-none disabled:opacity-60"
      }
      style={
        armed
          ? { background: "var(--color-accent)", boxShadow: "0 2px 9px rgba(0,0,0,0.5)" }
          : { filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6)) drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }
      }
    >
      {armed ? (
        // Armed → a labelled "＋ Add" pill: an explicit call to action, so it's obvious a click still adds the item.
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add
        </>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5 v14 M5 12 h14" />
        </svg>
      )}
    </button>
  );
}
