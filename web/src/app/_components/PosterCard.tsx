"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { toggleMovieFavorite } from "@/app/movies/actions";
import { toggleFavorite as toggleShowFavorite } from "@/app/shows/actions";
import { posterUrl } from "@/lib/images";

// The shared poster-grid card (design reference): a 2:3 poster with an IMDb ★ rating chip (top-left) and a
// favourite heart (top-right), over which a play triangle (in-Plex items) or a download-source menu (Download view)
// is revealed on hover; below it, a page-specific text body passed as `children`. One component so every view's
// cards read and behave identically. Client because the heart toggles optimistically and the hover states are CSS
// on `.wn-posterwrap`.

export type DownloadOption = { label: string; href: string };

export function PosterCard({
  mediaType,
  id,
  title,
  posterPath,
  detailHref,
  watchUrl,
  rating,
  isFavorite,
  canFavorite,
  downloadOptions,
  children,
}: {
  mediaType: "tv" | "movie";
  id: string;
  title: string;
  posterPath: string | null;
  detailHref: string;
  watchUrl?: string | null;
  rating?: number | null; // IMDb score, already visibility-filtered by the caller; null → no chip
  isFavorite: boolean;
  canFavorite: boolean; // owner + favouriting enabled → interactive; otherwise a read-only badge
  downloadOptions?: DownloadOption[];
  children: ReactNode;
}) {
  const showDlMenu = !!downloadOptions && downloadOptions.length > 0;
  const showPlay = !showDlMenu && !!watchUrl;

  return (
    <div
      className="wn-posterwrap wn-card relative cursor-pointer overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 16px 38px -22px rgba(0,0,0,0.85)" }}
    >
      <div className="relative aspect-[2/3] overflow-hidden">
        <CardPoster path={posterPath} alt={title} />

        {/* Click target covering the poster: opens Plex when playable, else navigates to the detail page. It sits
            below the chips/heart/menu (z-1) so those stay clickable. */}
        {watchUrl ? (
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Play ${title} in Plex`}
            className="absolute inset-0 z-[1]"
          />
        ) : (
          <Link href={detailHref} aria-label={title} className="absolute inset-0 z-[1]" />
        )}

        {showPlay && (
          <span className="wn-play-overlay pointer-events-none">
            <svg
              width="42"
              height="48"
              viewBox="0 0 8 9"
              fill="#ffffff"
              style={{ filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.7))" }}
              aria-hidden
            >
              <path d="M0 0.5 L8 4.5 L0 8.5 Z" />
            </svg>
          </span>
        )}

        {showDlMenu && (
          <span className="wn-dlmenu z-[2]">
            {downloadOptions!.map((o) => (
              <a
                key={o.href}
                href={o.href}
                target="_blank"
                rel="noopener noreferrer"
                className="wn-dlopt"
                onClick={(e) => e.stopPropagation()}
              >
                {o.label}
              </a>
            ))}
          </span>
        )}

        {rating != null && (
          <span
            className="pointer-events-none absolute top-[9px] left-[9px] z-[2] inline-flex h-[22px] items-center gap-1 font-num text-[15px] font-semibold tabular-nums"
            style={{
              color: "#f0f0f3",
              textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)",
              WebkitTextStroke: "0.5px rgba(0,0,0,0.4)",
            }}
          >
            ★ {rating.toFixed(1)}
          </span>
        )}

        <FavoriteHeart mediaType={mediaType} id={id} isFavorite={isFavorite} canFavorite={canFavorite} />
      </div>

      {/* The text body always links to the detail page — the poster may instead play in Plex, so this keeps the
          show/movie page (seasons, tracking, favouriting) reachable from every card. */}
      <Link href={detailHref} className="block px-[13px] pt-3 pb-[13px]">
        {children}
      </Link>
    </div>
  );
}

function CardPoster({ path, alt }: { path: string | null; alt: string }) {
  const url = posterUrl(path, "w342");
  if (!url) {
    return (
      <div className="wn-poster absolute inset-0 flex items-center justify-center bg-[var(--color-surface-2)] p-3 text-center text-[11px] leading-tight text-[var(--color-muted)]">
        {alt}
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes="(max-width: 768px) 45vw, 240px"
      className="wn-poster object-cover"
      loading="lazy"
    />
  );
}

// The favourite heart. Owner: an optimistic toggle button (filled ♥ amber when favourited; empty ♡ that fades in on
// card hover otherwise). Non-owner: a read-only filled heart, shown only when the item is a favourite.
function FavoriteHeart({
  mediaType,
  id,
  isFavorite,
  canFavorite,
}: {
  mediaType: "tv" | "movie";
  id: string;
  isFavorite: boolean;
  canFavorite: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(isFavorite);
  const [, startTransition] = useTransition();

  const heartStyle = {
    color: optimistic ? "var(--color-behind)" : "#c4c4cc",
    WebkitTextStroke: "0.7px rgba(0,0,0,0.22)",
  } as const;
  const glyph = optimistic ? "♥" : "♡";
  const posCls = "absolute top-[9px] right-[9px] z-[3] text-[22px] leading-[22px]";

  if (!canFavorite) {
    if (!isFavorite) return null;
    return (
      <span className={posCls} style={{ color: "var(--color-behind)", WebkitTextStroke: "0.7px rgba(0,0,0,0.22)" }}>
        ♥
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={optimistic ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={optimistic}
      className={`wn-heart ${posCls} ${optimistic ? "" : "fav0"}`}
      style={heartStyle}
      onClick={(e) => {
        e.stopPropagation();
        startTransition(async () => {
          setOptimistic(!optimistic);
          if (mediaType === "tv") await toggleShowFavorite(id);
          else await toggleMovieFavorite(id);
        });
      }}
    >
      {glyph}
    </button>
  );
}
