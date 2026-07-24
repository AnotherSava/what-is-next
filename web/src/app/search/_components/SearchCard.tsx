"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CardShell } from "@/app/_components/CardShell";
import { PosterImage } from "@/app/_components/PosterImage";
import { CardTitle, RatingBadge } from "@/app/_components/cardUi";
import type { TitleResult } from "@/lib/search";
import { addTitle } from "../actions";

// A movie/show search result card (design reference "Search" screen). The frame + text body match the poster-grid
// PosterCard, but the top-right corner shows a *status* instead of a favourite toggle:
//   • in library + favourited → ♥ (amber, display only)
//   • in library              → ✓ (green, display only)
//   • not in library          → + (adds it: creates the tracked stub, then flips to ✓)
// Library cards link to their detail page; external cards aren't linkable (nothing to open until they're added).
export function SearchCard({ result }: { result: TitleResult }) {
  const [added, setAdded] = useState(false);
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
      setAdded(true);
    });

  const media = (
    <div className="wn-postermedia relative aspect-[2/3] overflow-hidden">
      <PosterImage path={result.posterPath} alt={result.title} />

      {/* Library rows: the whole poster navigates to the detail page (sits below the chips/status corner). */}
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
        <AddMark pending={pending} onAdd={onAdd} />
      )}
    </div>
  );

  const body = (
    <>
      <CardTitle title={result.title} aside={result.year} />
      {result.mediaType === "movie" && result.overview && (
        // One-line synopsis, ellipsized; the native title tooltip reveals the full text on hover.
        <p title={result.overview} className="mt-[3px] truncate text-[12.5px] text-[var(--color-muted)]">
          {result.overview}
        </p>
      )}
    </>
  );

  return (
    <CardShell>
      {media}
      {result.detailHref ? (
        <Link href={result.detailHref} className="block cursor-pointer px-[13px] pt-3 pb-[13px]">
          {body}
        </Link>
      ) : (
        <div className="px-[13px] pt-3 pb-[13px]">{body}</div>
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

// White plus — not in your library; adds it (start tracking).
function AddMark({ pending, onAdd }: { pending: boolean; onAdd: () => void }) {
  return (
    <button
      type="button"
      title="Add to your library"
      aria-label="Add to your library"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAdd();
      }}
      className="wn-addmark absolute top-[8px] right-[8px] z-[3] cursor-pointer leading-none disabled:opacity-60"
      style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6)) drop-shadow(0 2px 5px rgba(0,0,0,0.4))" }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5 v14 M5 12 h14" />
      </svg>
    </button>
  );
}
