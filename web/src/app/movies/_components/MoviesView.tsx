"use client";

import { useEffect, useMemo, useState } from "react";
import { CardMetaRow, CardTitle, GroupHeading, PageTitle } from "@/app/_components/cardUi";
import { SearchBox } from "@/app/_components/Filters";
import { PosterCard } from "@/app/_components/PosterCard";
import { compareMovies, MOVIE_SORT_COOKIE, type MovieSortFields, type MovieSortKey } from "@/lib/movieSort";
import { MovieSortMenu } from "./MovieSortMenu";

// A movie as the Movies grid needs it — display strings precomputed on the server. `list` picks the shelf
// (Planned = watchlist, Watched = watched).
export type MovieCardData = {
  id: string;
  slug: string | null;
  title: string;
  posterPath: string | null;
  watchUrl: string | null;
  watchOn: string | null; // which server the play link opens, for the label
  rating: number | null;
  isFavorite: boolean;
  list: "watchlist" | "watched";
  year: string;
  director: string;
  runtime: string;
  sortDate: number | null; // epoch ms for the "watch/added date" sort — watch date (watched) or added date (planned)
};

// Adapt a card to the fields the shared comparator reads (year parsed from its 4-digit display string; "" → null).
function sortFields(m: MovieCardData): MovieSortFields {
  return { title: m.title, rating: m.rating, year: m.year ? Number(m.year) : null, sortDate: m.sortDate };
}

const GROUPS = [
  { key: "watchlist", label: "Planned", color: "#7d95ff" },
  { key: "watched", label: "Watched", color: "#37b26b" },
] as const;

export function MoviesView({
  movies,
  canFavorite,
  initialSort,
}: {
  movies: MovieCardData[];
  canFavorite: boolean;
  initialSort: MovieSortKey;
}) {
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<MovieSortKey>(initialSort);
  const q = query.trim().toLowerCase();

  // Persist the chosen order like the grid-density cookie, so returning to Movies keeps it (server seeds the same).
  useEffect(() => {
    document.cookie = `${MOVIE_SORT_COOKIE}=${sort}; path=/; max-age=31536000; samesite=lax`;
  }, [sort]);

  const groupsView = useMemo(() => {
    const cmp = compareMovies(sort);
    return GROUPS.map((g) => ({
      ...g,
      items: movies
        .filter((m) => m.list === g.key && (!q || m.title.toLowerCase().includes(q)) && (!favOnly || m.isFavorite))
        .map((m) => ({ m, f: sortFields(m) }))
        .sort((a, b) => cmp(a.f, b.f))
        .map((x) => x.m),
    })).filter((g) => g.items.length > 0);
  }, [movies, q, favOnly, sort]);
  const empty = groupsView.length === 0;

  return (
    <div>
      <div className="mb-[22px] flex items-center gap-[14px]">
        <PageTitle>Movies</PageTitle>
        <span className="ml-auto flex items-center gap-2">
          <MovieSortMenu value={sort} onChange={setSort} />
          <button
            type="button"
            aria-pressed={favOnly}
            aria-label="Favourites"
            title="Favourites"
            onClick={() => setFavOnly((v) => !v)}
            className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border text-[17px] leading-none transition-colors ${
              favOnly
                ? "border-[#f5a524]/40 bg-[#f5a524]/12 text-[var(--color-behind)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text)]"
            }`}
          >
            <span aria-hidden>{favOnly ? "♥" : "♡"}</span>
          </button>
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
                  watchOn={m.watchOn}
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
