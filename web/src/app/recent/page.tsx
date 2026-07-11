import type { Metadata } from "next";
import Link from "next/link";
import { Poster } from "@/app/_components/Poster";
import { displayDate } from "@/lib/datetime";
import { getRecentWatches, type RecentWatch } from "@/lib/recent";
import { getDisplayedUser } from "@/lib/session";

export const metadata: Metadata = { title: "Recently watched" };

function epCode(season: number | null, episode: number | null): string {
  if (season == null || episode == null) return "";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function shortDate(d: Date | null): string {
  return d ? displayDate(d) : "date unknown";
}

// Where a watch came from — shown as a small tag so the feed makes its provenance explicit.
function sourceLabel(source: string): string {
  return source === "plex" ? "Plex" : source === "tvtime-import" ? "TV Time" : "App";
}

export default async function RecentPage() {
  const displayedUser = await getDisplayedUser();
  const watches = await getRecentWatches(displayedUser.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recently watched</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Your watch history — newest first, tagged by source.</p>
      </div>

      {watches.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          No watch history yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {watches.map((w) => (
            <RecentRow key={w.id} watch={w} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentRow({ watch }: { watch: RecentWatch }) {
  const href = watch.mediaType === "tv" ? `/shows/${watch.mediaItemId}` : "/movies";
  const code = epCode(watch.seasonNumber, watch.episodeNumber);
  const isPlex = watch.source === "plex";
  return (
    <li className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <Link href={href} className="shrink-0">
        <Poster path={watch.posterPath} alt={watch.title} width={48} height={72} size="w185" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="truncate font-medium hover:underline">
            {watch.title}
          </Link>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              isPlex ? "bg-[#e5a00d] text-black" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
            }`}
          >
            {sourceLabel(watch.source)}
          </span>
        </div>
        <div>
          {watch.kind === "episode" && (
            <p className="truncate text-xs text-[var(--color-muted)]">
              {code}
              {watch.episodeTitle ? ` · ${watch.episodeTitle}` : ""}
            </p>
          )}
          <p className="text-xs text-[var(--color-muted)]">Watched {shortDate(watch.watchedAt)}</p>
        </div>
      </div>
    </li>
  );
}
