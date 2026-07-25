"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchScope } from "@/lib/search";

// The Search page's controls (design reference "Search" screen): a Movie/Show/Person scope segmented control, a
// search box, and a Search button. Client — it drives the URL (?scope=&q=) and the server component re-renders the
// results. A scope click re-runs immediately (keeping the current text); Enter or the button submit the typed text;
// Esc resets the page — clears the box and drops any results (back to a bare /search). While a submit is in flight
// the magnifier does the reference "scanning" jiggle (.wn-scan).

const SCOPES: { key: SearchScope; label: string }[] = [
  { key: "movie", label: "Movie" },
  { key: "show", label: "Show" },
  { key: "person", label: "Person" },
];

const PLACEHOLDER: Record<SearchScope, string> = {
  movie: "Movie title or keyword…",
  show: "Show title or keyword…",
  person: "Actor, director or creator name…",
};

// Per-tab memory of the last committed search, so returning to a bare /search — the nav "Search" link carries no
// query — restores the previous query + results instead of an empty page. sessionStorage: scoped to the tab session,
// cleared on close; the query already lives in the URL for back/forward navigation.
const STORAGE_KEY = "wn:search";

export function SearchControls({ scope, query }: { scope: SearchScope; query: string }) {
  const router = useRouter();
  const [text, setText] = useState(query);
  const [committedQuery, setCommittedQuery] = useState(query);
  const [pending, start] = useTransition();
  const restoreChecked = useRef(false);

  // Resync the box to the committed URL query (submit, the nav "Search" link, browser back/forward). Done during
  // render — React's recommended "adjust state when a prop changes" pattern — so it keeps focus/cursor (no remount)
  // and doesn't disturb in-flight typing, since `query` only changes on a real navigation, never on keystrokes.
  if (query !== committedQuery) {
    setCommittedQuery(query);
    setText(query);
  }

  // Remember the current search whenever the page has a query (however we arrived — submit, direct URL, restore) so
  // it survives leaving and coming back to Search.
  useEffect(() => {
    if (!query) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ q: query, scope }));
    } catch {}
  }, [query, scope]);

  // On the first mount with no query — i.e. we landed on a bare /search (the nav "Search" link) — restore the last
  // remembered search. Runs once; a deliberate empty search (handled in `run`) forgets it so this won't re-fill.
  useEffect(() => {
    if (restoreChecked.current) return;
    restoreChecked.current = true;
    if (query) return; // arrived with a query — nothing to restore
    let saved: { q?: string; scope?: SearchScope } | null = null;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {}
    if (saved?.q) {
      const params = new URLSearchParams({ scope: saved.scope ?? "movie", q: saved.q });
      router.replace(`/search?${params.toString()}`);
    }
  }, [query, router]);

  // Forget the last remembered search so returning to a bare /search stays empty. Shared by a deliberate empty
  // search and by Esc's page reset, so the two can't drift.
  const forgetSaved = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const run = (nextScope: SearchScope, nextText: string) => {
    const params = new URLSearchParams({ scope: nextScope });
    const q = nextText.trim();
    if (q) {
      params.set("q", q);
    } else {
      forgetSaved(); // a deliberate empty search forgets the remembered one, so returning to Search stays empty
    }
    start(() => router.push(`/search?${params.toString()}`));
  };

  return (
    <div className="mb-[30px] flex items-stretch gap-[12px]">
      <div className="flex shrink-0 items-stretch gap-[2px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[3px]">
        {SCOPES.map((s) => {
          const active = s.key === scope;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => !active && run(s.key, text)}
              aria-pressed={active}
              className={`font-display flex cursor-pointer items-center rounded-[8px] px-[14px] text-[13px] font-semibold transition-colors ${
                active
                  ? "bg-[rgba(125,149,255,0.16)] text-white"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 items-center gap-[10px] rounded-[11px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[14px] py-[11px]">
        <svg
          className={pending ? "wn-scan" : ""}
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--color-faint)"
          strokeWidth="1.7"
          style={{ flexShrink: 0 }}
          aria-hidden
        >
          <circle cx="9" cy="9" r="6" />
          <path d="M17 17 l-4-4" />
        </svg>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run(scope, text);
            } else if (e.key === "Escape" && (text || committedQuery)) {
              // Esc resets the page to its pristine empty state: clear the box, forget the remembered search, and —
              // when results are showing — drop them by navigating back to a bare /search. So nothing lingers below
              // or on the next visit.
              e.preventDefault();
              setText("");
              if (committedQuery) run(scope, ""); // navigates to bare /search; run("") also forgets the remembered search
              else forgetSaved(); // no results to drop, but forget any stale remembered search from an earlier submit
            }
          }}
          autoFocus
          placeholder={PLACEHOLDER[scope]}
          className="w-full border-none bg-transparent text-[14px] text-[var(--color-text)] outline-none"
        />
      </div>

      <button
        type="button"
        onClick={() => run(scope, text)}
        className="wn-btn font-display flex shrink-0 items-center justify-center px-[22px] py-[11px] text-[13.5px] font-semibold"
      >
        Search
      </button>
    </div>
  );
}
