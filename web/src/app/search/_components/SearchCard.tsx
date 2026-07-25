"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AddMark } from "@/app/_components/AddMark";
import { CardShell } from "@/app/_components/CardShell";
import { PosterImage } from "@/app/_components/PosterImage";
import { CardTitle, RatingBadge } from "@/app/_components/cardUi";
import type { TitleResult } from "@/lib/search";
import { addTitle } from "../actions";

// Items added to the library during THIS session, remembered in module memory. It survives client-side navigation
// (going to an item's page and back, or revisiting Search) but clears on a full page reload. Why it's needed: a
// history-POP back-navigation restores /search from the browser's Router Cache — which keeps the page state we
// *want* (same query, results, scroll), but predates the add, so it re-renders the item as "not in library". The
// ✓ was optimistic-only React state that resets on remount; consulting this set on mount keeps it. On a real reload
// the dynamic server render (straight from the DB) is authoritative and shows ✓ on its own. Keyed `mediaType:tmdbId`.
const addedThisSession = new Set<string>();

// A movie/show search result card (design reference "Search" screen). The frame + text body match the poster-grid
// PosterCard, but the top-right corner shows a *status* instead of a favourite toggle:
//   • in library + favourited → ♥ (amber, display only)
//   • in library              → ✓ (green, display only)
//   • not in library          → + (two-step: click arms it, click again adds — creates the tracked stub, then flips to ✓)
// Every card links to a detail view — library cards to their real page, external cards to a read-only TMDB
// preview (/movies|/shows/preview/<tmdbId>). The + still adds in place: it stops propagation, so a poster/body
// click opens the preview while the + button itself only tracks the item.
export function SearchCard({ result }: { result: TitleResult }) {
  const sessionKey = result.tmdbId != null ? `${result.mediaType}:${result.tmdbId}` : null;
  // Initialise from module memory so a card added earlier this session still reads as in-library after a back-nav
  // remount (see addedThisSession above). result.inLibrary already covers items the fresh server render knows about.
  const [added, setAdded] = useState(() => sessionKey != null && addedThisSession.has(sessionKey));
  const [pending, start] = useTransition();
  const inLibrary = result.inLibrary || added;

  const onAdd = () =>
    start(async () => {
      if (result.tmdbId == null) return;
      await addTitle({
        tmdbId: result.tmdbId,
        mediaType: result.mediaType,
        title: result.title,
        posterPath: result.posterPath,
      });
      if (sessionKey) addedThisSession.add(sessionKey);
      setAdded(true);
    });

  const media = (
    <div className="wn-postermedia relative aspect-[2/3] overflow-hidden">
      <PosterImage path={result.posterPath} alt={result.title} />

      {/* The whole poster navigates — library → detail page, external → preview (sits below the status corner). */}
      {result.detailHref && (
        <Link href={result.detailHref} aria-label={result.title} className="absolute inset-0 z-[1]" />
      )}

      {result.rating != null && (
        <RatingBadge value={result.rating} className="absolute top-[9px] left-[9px] z-[2] h-[22px]" />
      )}

      {inLibrary ? (
        result.isFavorite ? (
          <FavouriteMark />
        ) : (
          <LibraryMark />
        )
      ) : (
        <AddMark pending={pending} onConfirm={onAdd} />
      )}
    </div>
  );

  const body = (
    <>
      <CardTitle title={result.title} aside={result.year} />
      {result.mediaType === "movie" && result.overview && (
        // One-line synopsis, ellipsized; the native title tooltip reveals the full text on hover.
        <p title={result.overview} className="wn-ct-over mt-[3px] truncate text-[var(--color-muted)]">
          {result.overview}
        </p>
      )}
    </>
  );

  return (
    <CardShell>
      {media}
      {result.detailHref ? (
        <Link href={result.detailHref} className="wn-ct-body block cursor-pointer">
          {body}
        </Link>
      ) : (
        <div className="wn-ct-body">{body}</div>
      )}
    </CardShell>
  );
}

// Amber heart — the item is a favourite. Display only; pointer-events-none so a poster click still navigates.
function FavouriteMark() {
  return (
    <span
      title="Favourite"
      className="pointer-events-none absolute top-[9px] right-[9px] z-[3] text-[22px] leading-[22px]"
      style={{ color: "var(--color-behind)", WebkitTextStroke: "0.7px rgba(0,0,0,0.22)" }}
    >
      ♥
    </span>
  );
}

// Green check — the item is in your library (tracked, not favourited). Display only.
function LibraryMark() {
  return (
    <span
      title="In your library"
      className="pointer-events-none absolute top-[8px] right-[8px] z-[3] leading-none"
      style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6)) drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3ec97a" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 l4.5 4.5 L19 6.5" />
      </svg>
    </span>
  );
}

