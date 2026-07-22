import Image from "next/image";
import { RatingBadge } from "@/app/_components/cardUi";
import { posterUrl } from "@/lib/images";
import { ShowHeroHeart } from "./ShowHeroHeart";

// The show-detail hero poster (design: "Shows Page - Seasons"). Same language as the movie hero: hovering the
// poster reveals a big Play triangle when the show is in Plex (the whole poster deep-links to Plex, which resumes
// the next unwatched episode), a ★ rating chip sits top-left, the favourite heart top-right, and a thin watch-
// progress bar runs along the bottom. Server-rendered; the heart is the one client island inside.
export function ShowHeroPoster({
  showId,
  title,
  posterPath,
  watchUrl,
  rating,
  isFavorite,
  canFavorite,
  progressPct,
}: {
  showId: string;
  title: string;
  posterPath: string | null;
  watchUrl: string | null; // Plex deep-link when the show is in Plex and its ratingKey is known; else null → inert poster
  rating: number | null; // IMDb (preferred) or TMDB score for the ★ chip; null hides it
  isFavorite: boolean;
  canFavorite: boolean;
  progressPct: number | null; // watched/aired percentage for the bottom bar; null when nothing has aired (no bar)
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

      {watchUrl && (
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="wn-play-overlay" aria-label={`Play ${title} in Plex`}>
          <svg width="48" height="54" viewBox="0 0 8 9" fill="#fff" aria-hidden style={{ filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.55))" }}>
            <path d="M0 0.5 L8 4.5 L0 8.5 Z" />
          </svg>
        </a>
      )}

      {rating != null && <RatingBadge value={rating} className="absolute top-[10px] left-[10px] z-[3]" />}

      <ShowHeroHeart showId={showId} isFavorite={isFavorite} canFavorite={canFavorite} />

      {progressPct != null && (
        <div className="absolute inset-x-0 bottom-0 z-[3] h-[5px]" style={{ background: "rgba(8,8,10,0.55)" }}>
          <div className="h-full" style={{ width: `${progressPct}%`, background: "var(--color-accent)" }} />
        </div>
      )}
    </div>
  );
}
