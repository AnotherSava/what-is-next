"use client";

import { useTransition } from "react";
import { PlexBadge } from "@/app/_components/PlexBadge";
import type { ShowDetailEpisode, ShowDetailSeason } from "@/lib/shows";
import { markEpisodeWatched, markSeasonWatched, markWatchedUpTo, unmarkEpisodeWatched } from "../actions";

// Seasons as collapsible episode checklists (brief §8.3). Aired vs unaired are visually distinct; watched
// episodes show a filled check. In viewer mode (canEdit=false) everything is static — no mutation controls.

function code(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

export function EpisodeChecklist({
  showId,
  seasons,
  canEdit,
}: {
  showId: string;
  seasons: ShowDetailSeason[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      {seasons.map((season) => (
        <SeasonBlock key={season.seasonNumber} showId={showId} season={season} canEdit={canEdit} />
      ))}
    </div>
  );
}

function SeasonBlock({ showId, season, canEdit }: { showId: string; season: ShowDetailSeason; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const label = season.isSpecials ? "Specials" : (season.title ?? `Season ${season.seasonNumber}`);
  const fullyWatched = season.airedCount > 0 && season.watchedCount >= season.airedCount;
  // Open seasons that have aired episodes still to watch.
  const openByDefault = season.airedCount > season.watchedCount;

  return (
    <details
      open={openByDefault}
      className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="font-medium">{label}</span>
        {season.inPlex && <PlexBadge dot />}
        <span className="text-sm text-[var(--color-muted)]">
          {season.watchedCount}/{season.airedCount || season.episodes.length}
        </span>
        {canEdit && !fullyWatched && season.airedCount > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              start(() => markSeasonWatched(showId, season.seasonNumber));
            }}
            className="ml-auto rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs hover:bg-[var(--color-border)] disabled:opacity-50"
          >
            Mark season watched
          </button>
        )}
      </summary>
      <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
        {season.episodes.map((ep) => (
          <EpisodeRow key={ep.id} ep={ep} canEdit={canEdit} />
        ))}
      </ul>
    </details>
  );
}

function EpisodeRow({ ep, canEdit }: { ep: ShowDetailEpisode; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      {canEdit ? (
        <button
          type="button"
          aria-label={ep.watched ? "Mark unwatched" : "Mark watched"}
          aria-pressed={ep.watched}
          disabled={pending}
          onClick={() => start(() => (ep.watched ? unmarkEpisodeWatched(ep.id) : markEpisodeWatched(ep.id)))}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs transition-colors disabled:opacity-50 ${
            ep.watched
              ? "border-[var(--color-good)] bg-[var(--color-good)] text-black"
              : "border-[var(--color-border)] hover:border-[var(--color-good)]"
          }`}
        >
          {ep.watched ? "✓" : ""}
        </button>
      ) : (
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
            ep.watched ? "border-[var(--color-good)] bg-[var(--color-good)] text-black" : "border-[var(--color-border)]"
          }`}
        >
          {ep.watched ? "✓" : ""}
        </span>
      )}

      <span className="w-16 shrink-0 font-mono text-xs text-[var(--color-muted)]">
        {code(ep.seasonNumber, ep.episodeNumber)}
      </span>

      <span className={`flex-1 truncate ${ep.aired ? "" : "text-[var(--color-muted)]"}`}>
        {ep.title ?? "TBA"}
        {!ep.aired && ep.releaseDate && (
          <span className="ml-2 text-xs text-[var(--color-accent)]">airs {ep.releaseDate}</span>
        )}
        {!ep.aired && !ep.releaseDate && <span className="ml-2 text-xs text-[var(--color-muted)]">unaired</span>}
      </span>

      {canEdit && ep.aired && !ep.watched && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => markWatchedUpTo(ep.id))}
          title="Mark this and all earlier aired episodes watched"
          className="shrink-0 rounded-md px-2 py-0.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
        >
          up to here
        </button>
      )}
    </li>
  );
}
