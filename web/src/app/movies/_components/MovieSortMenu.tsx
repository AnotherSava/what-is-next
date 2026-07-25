"use client";

import { useEffect, useRef, useState } from "react";
import { MOVIE_SORT_OPTIONS, type MovieSortKey } from "@/lib/movieSort";

// The /movies sort picker: a chip-styled trigger showing the current order that opens a .wn-menu of the four sort
// options (design reference). A disclosure of plain buttons like HeroKebabMenu — Escape-to-close, outside-click
// overlay, focus-return to the trigger — deliberately not a full ARIA menu widget. The owning MoviesView holds the
// selected key (and persists it to a cookie); this component only reflects it and reports changes.
export function MovieSortMenu({ value, onChange }: { value: MovieSortKey; onChange: (v: MovieSortKey) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = MOVIE_SORT_OPTIONS.find((o) => o.key === value) ?? MOVIE_SORT_OPTIONS[0];

  const close = () => setOpen(false);
  const pick = (key: MovieSortKey) => {
    close();
    btnRef.current?.focus(); // restore focus before the parent re-renders the grid
    onChange(key);
  };

  // Escape closes the menu and restores focus to its trigger (mouse users get the outside-click overlay below).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="wn-chip"
        data-on={open}
        aria-expanded={open}
        aria-label={`Sort movies — ${current.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 20V5" />
          <path d="M4 8l3-3 3 3" />
          <path d="M17 4v15" />
          <path d="M14 16l3 3 3-3" />
        </svg>
        {current.label}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 8l7 7 7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden />
          <div className="wn-menu absolute top-full left-0 z-30 mt-2">
            {MOVIE_SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className="wn-menu-item"
                aria-current={o.key === value}
                onClick={() => pick(o.key)}
              >
                <span className="inline-block w-[16px] text-[var(--color-accent)]">{o.key === value ? "✓" : ""}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
