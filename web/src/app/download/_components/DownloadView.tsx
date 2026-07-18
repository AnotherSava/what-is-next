"use client";

import { useMemo, useState } from "react";
import { CardMetaRow, CardTitle, GroupHeading, PageTitle } from "@/app/_components/cardUi";
import { FilterChip } from "@/app/_components/Filters";
import { PosterCard, type DownloadOption } from "@/app/_components/PosterCard";

export type DownloadShowCard = {
  kind: "show";
  id: string;
  slug: string | null;
  title: string;
  posterPath: string | null;
  rating: number | null;
  isFavorite: boolean;
  shelfMeta: string;
  dlOptions: DownloadOption[];
};

export type DownloadMovieCard = {
  kind: "movie";
  id: string;
  slug: string | null;
  title: string;
  posterPath: string | null;
  rating: number | null;
  isFavorite: boolean;
  year: string;
  director: string;
  runtime: string;
  dlOptions: DownloadOption[];
};

// The four shelves the Download view renders, each already resolved to its cards on the server. `kind` on each
// section decides whether the Shows / Movies chip keeps it.
export type DownloadSection = {
  key: string;
  label: string;
  color: string;
  kind: "shows" | "movies";
  items: (DownloadShowCard | DownloadMovieCard)[];
};

export function DownloadView({
  sections,
  showCount,
  movieCount,
  canFavorite,
}: {
  sections: DownloadSection[];
  showCount: number;
  movieCount: number;
  canFavorite: boolean;
}) {
  const [type, setType] = useState<"all" | "shows" | "movies">("all");
  const view = useMemo(() => sections.filter((s) => type === "all" || s.kind === type), [sections, type]);

  const chips = [
    { key: "all", label: "All", count: showCount + movieCount },
    { key: "shows", label: "Shows", count: showCount },
    { key: "movies", label: "Movies", count: movieCount },
  ] as const;

  return (
    <div>
      <div className="mb-5">
        <PageTitle>Download</PageTitle>
      </div>

      <div className="mb-7 flex flex-wrap gap-2">
        {chips.map((c) => (
          <FilterChip key={c.key} active={type === c.key} onClick={() => setType(c.key)} label={c.label} count={c.count} />
        ))}
      </div>

      {view.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          Nothing to download — everything you&rsquo;re tracking is already in your Plex library.
        </div>
      ) : (
        view.map((s) => (
          <div key={s.key} className="mb-[34px]">
            <GroupHeading color={s.color} label={s.label} />
            <div className="wn-grid">
              {s.items.map((it) => (
                <PosterCard
                  key={it.id}
                  mediaType={it.kind === "show" ? "tv" : "movie"}
                  id={it.id}
                  title={it.title}
                  posterPath={it.posterPath}
                  detailHref={it.kind === "show" ? `/shows/${it.slug ?? it.id}` : `/movies/${it.slug ?? it.id}`}
                  rating={it.rating}
                  isFavorite={it.isFavorite}
                  canFavorite={canFavorite}
                  downloadOptions={it.dlOptions}
                >
                  {it.kind === "show" ? (
                    <>
                      <CardTitle title={it.title} />
                      <div className="mt-[3px]">
                        <span className="font-num text-[11px] tabular-nums text-[#b6b6c0]">{it.shelfMeta}</span>
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
        ))
      )}
    </div>
  );
}
