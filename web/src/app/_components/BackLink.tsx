"use client";

import { useRouter } from "next/navigation";

// A "go back" affordance that returns to wherever the user came from (Home / Recent / Search / Movies / Download …)
// by popping browser history, rather than hard-linking one destination. It's a best-effort heuristic: with prior
// history it pops one entry (router.back()); with none (a fresh tab / directly-opened link) it routes to
// `fallbackHref`. Caveat: `history.length` can't tell in-app entries from external ones, so a deep link opened in a
// tab that already had an external page will pop back to that page rather than to the fallback — an acceptable
// "back" either way for this personal showcase.
export function BackLink({
  fallbackHref,
  label = "Back",
  className = "",
}: {
  fallbackHref: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className={`cursor-pointer ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  );
}
