"use client";

import { useMemo, useState } from "react";
import { CardTitle, GroupHeading, PageTitle } from "@/app/_components/cardUi";
import { CardNextRow } from "@/app/_components/CardNextRow";
import { FilterChip, SearchBox } from "@/app/_components/Filters";
import { PosterCard } from "@/app/_components/PosterCard";

// A show as the Shows grid needs it — display strings precomputed on the server, plus the bits the card's poster
// area needs (rating/heart/play). `group` drives the status filter and which shelf it lands in.
export type ShowCardData = {
  id: string;
  title: string;
  posterPath: string | null;
  watchUrl: string | null;
  rating: number | null;
  isFavorite: boolean;
  group: "behind" | "up-to-date" | "planned" | "finished" | "stopped";
  lastText: string;
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
  const [status, setStatus] = useState<string>("all");
  const q = query.trim().toLowerCase();

  const groupsView = useMemo(
    () =>
      GROUPS.filter((g) => status === "all" || status === g.key)
        .map((g) => ({
          ...g,
          items: shows.filter((s) => s.group === g.key && (!q || s.title.toLowerCase().includes(q))),
        }))
        .filter((g) => g.items.length > 0),
    [shows, status, q],
  );
  const empty = groupsView.length === 0;

  const chips = [{ key: "all", label: "All", color: "#8b8b96", count: shows.length }].concat(
    GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      color: g.color,
      count: shows.filter((s) => s.group === g.key).length,
    })),
  );

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <PageTitle>Shows</PageTitle>
        <SearchBox value={query} onChange={setQuery} placeholder="Search shows" />
      </div>

      <div className="mb-7 flex flex-wrap gap-2">
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            active={status === c.key}
            onClick={() => setStatus(c.key)}
            color={c.color}
            label={c.label}
            count={c.count}
          />
        ))}
      </div>

      {empty ? (
        <div className="p-[60px] text-center text-sm text-[var(--color-faint)]">No shows match “{query}”.</div>
      ) : (
        groupsView.map((g) => (
          <div key={g.key} className="mb-[34px]">
            <GroupHeading color={g.color} label={g.label} />
            <div className="wn-grid">
              {g.items.map((s) => (
                <PosterCard
                  key={s.id}
                  mediaType="tv"
                  id={s.id}
                  title={s.title}
                  posterPath={s.posterPath}
                  detailHref={`/shows/${s.id}`}
                  watchUrl={s.watchUrl}
                  rating={s.rating}
                  isFavorite={s.isFavorite}
                  canFavorite={canFavorite}
                >
                  <CardTitle title={s.title} aside={s.lastText} />
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
