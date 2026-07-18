"use client";

import { useMemo, useState } from "react";
import { CardMetaRow, CardTitle, GroupHeading, PageTitle } from "@/app/_components/cardUi";
import { FilterChip, SearchBox } from "@/app/_components/Filters";
import { PosterCard } from "@/app/_components/PosterCard";

// A movie as the Movies grid needs it — display strings precomputed on the server. `list` picks the shelf
// (Planned = watchlist, Watched = watched).
export type MovieCardData = {
  id: string;
  slug: string | null;
  title: string;
  posterPath: string | null;
  watchUrl: string | null;
  rating: number | null;
  isFavorite: boolean;
  list: "watchlist" | "watched";
  year: string;
  director: string;
  runtime: string;
};

const GROUPS = [
  { key: "watchlist", label: "Planned", color: "#7d95ff" },
  { key: "watched", label: "Watched", color: "#37b26b" },
] as const;

export function MoviesView({ movies, canFavorite }: { movies: MovieCardData[]; canFavorite: boolean }) {
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const q = query.trim().toLowerCase();

  const groupsView = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: movies.filter(
          (m) => m.list === g.key && (!q || m.title.toLowerCase().includes(q)) && (!favOnly || m.isFavorite),
        ),
      })).filter((g) => g.items.length > 0),
    [movies, q, favOnly],
  );
  const empty = groupsView.length === 0;

  return (
    <div>
      <div className="mb-[22px] flex items-center gap-[14px]">
        <PageTitle>Movies</PageTitle>
        <span className="ml-auto flex items-center gap-2">
          <FilterChip active={favOnly} onClick={() => setFavOnly((v) => !v)} label={<>&#9829; Favourites</>} />
        </span>
        <SearchBox value={query} onChange={setQuery} placeholder="Search movies" />
      </div>

      {empty ? (
        <div className="p-[60px] text-center text-sm text-[var(--color-faint)]">No movies match “{query}”.</div>
      ) : (
        groupsView.map((g) => (
          <div key={g.key} className="mb-9">
            <GroupHeading color={g.color} label={g.label} />
            <div className="wn-grid">
              {g.items.map((m) => (
                <PosterCard
                  key={m.id}
                  mediaType="movie"
                  id={m.id}
                  title={m.title}
                  posterPath={m.posterPath}
                  detailHref={`/movies/${m.slug ?? m.id}`}
                  watchUrl={m.watchUrl}
                  rating={m.rating}
                  isFavorite={m.isFavorite}
                  canFavorite={canFavorite}
                >
                  <CardTitle title={m.title} aside={m.year} />
                  <CardMetaRow left={m.director} right={m.runtime} />
                </PosterCard>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
