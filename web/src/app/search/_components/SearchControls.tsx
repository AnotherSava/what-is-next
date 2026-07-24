"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchScope } from "@/lib/search";

// The Search page's controls (design reference "Search" screen): a Movie/Show/Person scope segmented control, a
// search box, and a Search button. Client — it drives the URL (?scope=&q=) and the server component re-renders the
// results. A scope click re-runs immediately (keeping the current text); Enter or the button submit the typed text;
// Esc clears the box. While a submit is in flight the magnifier does the reference "scanning" jiggle (.wn-scan).

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

export function SearchControls({ scope, query }: { scope: SearchScope; query: string }) {
  const router = useRouter();
  const [text, setText] = useState(query);
  const [committedQuery, setCommittedQuery] = useState(query);
  const [pending, start] = useTransition();

  // Resync the box to the committed URL query (submit, the nav "Search" link, browser back/forward). Done during
  // render — React's recommended "adjust state when a prop changes" pattern — so it keeps focus/cursor (no remount)
  // and doesn't disturb in-flight typing, since `query` only changes on a real navigation, never on keystrokes.
  if (query !== committedQuery) {
    setCommittedQuery(query);
    setText(query);
  }

  const run = (nextScope: SearchScope, nextText: string) => {
    const params = new URLSearchParams({ scope: nextScope });
    const q = nextText.trim();
    if (q) params.set("q", q);
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
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              setText("");
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
