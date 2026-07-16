"use client";

import { useMemo, useState } from "react";
import { CardMetaRow, CardTitle, PageTitle } from "@/app/_components/cardUi";
import { FilterChip, SearchBox } from "@/app/_components/Filters";
import { PosterCard } from "@/app/_components/PosterCard";

// A recent-watch card as the timeline needs it — an episode group (a show+season's watches collapsed, with a
// season label and optional episode range) or a single movie watch. Display strings are precomputed on the server.
export type RecentCard =
  | {
      kind: "episode";
      key: string;
      id: string;
      title: string;
      posterPath: string | null;
      rating: number | null;
      isFavorite: boolean;
      seasonLabel: string;
      epRange: string;
    }
  | {
      kind: "movie";
      key: string;
      id: string;
      title: string;
      posterPath: string | null;
      rating: number | null;
      isFavorite: boolean;
      year: string;
      director: string;
      runtime: string;
    };

export type RecentPeriodData = { period: string; items: RecentCard[] };

const TYPE_CHIPS = [
  { key: "all", label: "All" },
  { key: "episode", label: "Shows" },
  { key: "movie", label: "Movies" },
] as const;

export function RecentView({ periods, canFavorite }: { periods: RecentPeriodData[]; canFavorite: boolean }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const q = query.trim().toLowerCase();

  const view = useMemo(
    () =>
      periods
        .map((p) => ({
          period: p.period,
          items: p.items.filter(
            (it) => (type === "all" || it.kind === type) && (!q || it.title.toLowerCase().includes(q)),
          ),
        }))
        .filter((p) => p.items.length > 0),
    [periods, type, q],
  );
  const empty = view.length === 0;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <PageTitle>Recently watched</PageTitle>
        <SearchBox value={query} onChange={setQuery} placeholder="Search history" />
      </div>

      <div className="mb-[30px] flex gap-2">
        {TYPE_CHIPS.map((c) => (
          <FilterChip key={c.key} active={type === c.key} onClick={() => setType(c.key)} label={c.label} />
        ))}
      </div>

      {empty ? (
        <div className="p-[60px] text-center text-sm text-[var(--color-faint)]">Nothing matches “{query}”.</div>
      ) : (
        <div className="relative pl-7">
          {/* the timeline spine */}
          <span
            className="absolute top-[6px] bottom-[6px] left-[5px] w-[2px]"
            style={{ background: "linear-gradient(180deg,#26262e,transparent)" }}
          />
          {view.map((p) => (
            <div key={p.period} className="relative mb-7">
              <span
                className="absolute top-1 left-[-27px] h-3 w-3 rounded-full"
                style={{ background: "#0a0a0b", border: "2px solid #7d95ff" }}
              />
              <div className="mb-3 font-display text-[14px] font-semibold text-[var(--color-bright)]">{p.period}</div>
              <div className="wn-grid">
                {p.items.map((it) => (
                  <PosterCard
                    key={it.key}
                    mediaType={it.kind === "episode" ? "tv" : "movie"}
                    id={it.id}
                    title={it.title}
                    posterPath={it.posterPath}
                    detailHref={it.kind === "episode" ? `/shows/${it.id}` : `/movies/${it.id}`}
                    rating={it.rating}
                    isFavorite={it.isFavorite}
                    canFavorite={canFavorite}
                  >
                    {it.kind === "episode" ? (
                      <>
                        <CardTitle title={it.title} />
                        <div className="mt-[3px] truncate">
                          <span className="font-num text-[11px] tabular-nums text-[var(--color-behind)]">
                            {it.seasonLabel}
                          </span>
                          {it.epRange && (
                            <span className="ml-[6px] font-num text-[11px] tabular-nums text-[var(--color-muted)]">
                              · {it.epRange}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <CardTitle title={it.title} aside={it.year} />
                        <CardMetaRow left={it.director} right={it.runtime} />
                      </>
                    )}
                  </PosterCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
