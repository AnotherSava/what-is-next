"use client";

import { useMemo, useState } from "react";
import { CardTitle, GroupHeading, PageTitle } from "@/app/_components/cardUi";
import { CardNextRow } from "@/app/_components/CardNextRow";
import { SearchBox } from "@/app/_components/Filters";
import { PosterCard } from "@/app/_components/PosterCard";
import { ShowsWindowSelector } from "./ShowsWindowSelector";

// A show as the Shows grid needs it — display strings precomputed on the server, plus the bits the card's poster
// area needs (rating/heart/play). `group` drives the status filter and which shelf it lands in.
export type ShowCardData = {
  id: string;
  slug: string | null;
  title: string;
  posterPath: string | null;
  watchUrl: string | null;
  rating: number | null;
  isFavorite: boolean;
  group: "behind" | "up-to-date" | "planned" | "finished" | "stopped";
  lastText: string;
  lastTitle: string; // exact last-watched date behind lastText's relative "N ago"; "" when none
  nextCode: string | null;
  nextTitle: string | null;
  moreCount: number;
};

// Group order + colours from the design reference (Planned sits before Up to date here).
const GROUPS = [
  { key: "behind", label: "Behind", color: "#f5a524" },
  { key: "planned", label: "Planned", color: "#7d95ff" },
  { key: "up-to-date", label: "Up to date", color: "#37b26b" },
  { key: "finished", label: "Finished", color: "#8b8b96" },
  { key: "stopped", label: "Stopped", color: "#5c5c66" },
] as const;

export function ShowsView({ shows, canFavorite }: { shows: ShowCardData[]; canFavorite: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Every shelf renders stacked; search narrows the items and drops emptied shelves. There's no status filter — the
  // header window selector navigates between shelves rather than filtering to one.
  const groupsView = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: shows.filter((s) => s.group === g.key && (!q || s.title.toLowerCase().includes(q))),
      })).filter((g) => g.items.length > 0),
    [shows, q],
  );
  const empty = groupsView.length === 0;

  const windowGroups = useMemo(
    () => groupsView.map((g) => ({ key: g.key, label: g.label, count: g.items.length })),
    [groupsView],
  );

  return (
    <div>
      <ShowsWindowSelector groups={windowGroups} />

      <div className="mb-7 flex items-center justify-between gap-4">
        <PageTitle>Shows</PageTitle>
        <SearchBox value={query} onChange={setQuery} placeholder="Search shows" />
      </div>

      {empty ? (
        <div className="p-[60px] text-center text-sm text-[var(--color-faint)]">No shows match “{query}”.</div>
      ) : (
        groupsView.map((g) => (
          <div key={g.key} id={`shows-group-${g.key}`} className="mb-[34px]">
            <GroupHeading color={g.color} label={g.label} />
            <div className="wn-grid">
              {g.items.map((s) => (
                <PosterCard
                  key={s.id}
                  mediaType="tv"
                  id={s.id}
                  title={s.title}
                  posterPath={s.posterPath}
                  detailHref={`/shows/${s.slug ?? s.id}`}
                  watchUrl={s.watchUrl}
                  rating={s.rating}
                  isFavorite={s.isFavorite}
                  canFavorite={canFavorite}
                >
                  <CardTitle title={s.title} aside={s.lastText} asideTitle={s.lastTitle || undefined} />
                  {s.nextCode && <CardNextRow code={s.nextCode} epTitle={s.nextTitle} moreCount={s.moreCount} />}
                </PosterCard>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
