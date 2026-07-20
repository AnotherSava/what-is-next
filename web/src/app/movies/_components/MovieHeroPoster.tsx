import Image from "next/image";
import { RatingBadge } from "@/app/_components/cardUi";
import type { DownloadLink } from "@/lib/downloadSources";
import { posterUrl } from "@/lib/images";
import { MovieHeroHeart } from "./MovieHeroActions";

// The movie-detail hero poster (design: "Movies Page - Plex States", revised). Reuses the app's shared poster
// primitives (globals.css .wn-*): hover reveals a big Play triangle when the movie is in Plex (whole poster links
// to Plex), or a download-source picker when it isn't. A ★ IMDb badge sits top-left, the favourite heart top-right,
// and — when watched — a stamp along the bottom. Server-rendered; the heart is the one client island inside.

export function MovieHeroPoster({
  movieId,
  title,
  posterPath,
  inPlex,
  watchUrl,
  downloadLinks,
  rating,
  isFavorite,
  canFavorite,
  watchedStamp,
}: {
  movieId: string;
  title: string;
  posterPath: string | null;
  inPlex: boolean; // in Plex → the poster plays (or is inert if no deep-link); not in Plex → the download picker
  watchUrl: string | null; // Plex deep-link when resolvable; null even for in-Plex rows that predate ratingKey capture
  downloadLinks: DownloadLink[];
  rating: number | null;
  isFavorite: boolean;
  canFavorite: boolean;
  watchedStamp: string | null; // e.g. "WATCHED · JUN 2026"; null when unwatched
}) {
  const url = posterUrl(posterPath, "w342");

  return (
    <div
      className="wn-posterwrap wn-postermedia relative aspect-[2/3] w-[180px] shrink-0 self-start overflow-hidden rounded-[14px] border sm:w-[240px]"
      style={{ borderColor: "var(--color-border-elevated)", boxShadow: "0 26px 60px -22px rgba(0,0,0,0.92)" }}
    >
      {url ? (
        <Image src={url} alt={title} fill sizes="(max-width: 640px) 180px, 240px" className="wn-poster object-cover" />
      ) : (
        <div className="wn-poster absolute inset-0 flex items-center justify-center bg-[var(--color-surface-2)] p-3 text-center text-[12px] leading-tight text-[var(--color-muted)]">
          {title}
        </div>
      )}

      {watchUrl ? (
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="wn-play-overlay" aria-label={`Play ${title} in Plex`}>
          <svg width="48" height="54" viewBox="0 0 8 9" fill="#fff" aria-hidden style={{ filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.55))" }}>
            <path d="M0 0.5 L8 4.5 L0 8.5 Z" />
          </svg>
        </a>
      ) : !inPlex && downloadLinks.length > 0 ? (
        <span className="wn-dlmenu z-[2]">
          <span className="font-num mb-0.5 text-center text-[11px] font-bold tracking-[0.09em] text-[#aeb4c4]">SEARCH ON</span>
          {downloadLinks.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="wn-dlopt">
              {l.label}
            </a>
          ))}
        </span>
      ) : null}

      {rating != null && <RatingBadge value={rating} className="absolute top-[10px] left-[10px] z-[3]" />}

      <MovieHeroHeart movieId={movieId} isFavorite={isFavorite} canFavorite={canFavorite} />

      {watchedStamp && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex items-center justify-center gap-1.5 px-2.5 py-2"
          style={{ background: "linear-gradient(0deg, rgba(6,6,8,0.94), rgba(6,6,8,0.5))" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ededf0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span className="font-num text-[10px] font-semibold tracking-[0.04em] whitespace-nowrap text-[var(--color-text)]">{watchedStamp}</span>
        </div>
      )}
    </div>
  );
}
