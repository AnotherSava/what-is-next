"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";

// One item in a HeroKebabMenu: a label + the owner action it runs. `danger` styles it red (a destructive item);
// `separatorBefore` draws a divider above it (to group it apart from the items above).
export interface KebabItem {
  label: string;
  action: () => Promise<void>;
  danger?: boolean;
  separatorBefore?: boolean;
}

// The ⋯ actions menu shared by the movie and show detail heroes (single source of the disclosure mechanics so the
// two can't drift). Owns the open state, Escape-to-close, outside-click overlay, focus-return, and item rendering;
// callers supply only the items as data. A disclosure of plain buttons (Tab-navigable), deliberately not an ARIA
// menu widget, so it omits role="menu" and the arrow-key roving that implies. Clicking an item closes the menu,
// restores focus to the trigger (the action can unmount the focused item, so focus moves first), then runs it.
export function HeroKebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = () => setOpen(false);
  const run = (action: () => Promise<void>) => {
    close();
    btnRef.current?.focus();
    start(() => action());
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
    <div className="relative" style={{ opacity: pending ? 0.6 : 1 }}>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-white/[0.03] text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-hover)] hover:bg-white/[0.06] hover:text-[var(--color-text)]"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden />
          <div className="wn-menu absolute top-full right-0 z-30 mt-2">
            {items.map((item) => (
              <Fragment key={item.label}>
                {item.separatorBefore && <div className="wn-menu-sep" />}
                <button
                  type="button"
                  className={`wn-menu-item ${item.danger ? "wn-menu-item-danger" : ""}`}
                  onClick={() => run(item.action)}
                >
                  {item.label}
                </button>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
