import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Poster } from "@/app/_components/Poster";
import { getSessionUser } from "@/lib/session";
import { searchTitles, type SearchResult } from "@/lib/search";
import { TmdbError } from "@/lib/tmdb";
import { AddButton } from "./_components/AddButton";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  // Search-to-add is an owner-only affordance (brief §8.5) — viewers are bounced.
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/");

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let results: SearchResult[] = [];
  let error: string | null = null;
  if (query) {
    try {
      results = await searchTitles(query, sessionUser.id);
    } catch (e) {
      const authProblem =
        (e instanceof TmdbError && (e.status === 401 || e.status === 403)) ||
        (e instanceof Error && e.message.includes("TMDB_API_TOKEN"));
      error = authProblem ? "TMDB API token is missing or invalid — set TMDB_API_TOKEN." : "Search failed. Try again.";
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>

      <form action="/search" method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Search TV shows and movies…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          className="rounded-md bg-[var(--color-accent-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]"
        >
          Search
        </button>
      </form>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      {query && !error && results.length === 0 && (
        <p className="text-[var(--color-muted)]">No results for “{query}”.</p>
      )}

      <ul className="space-y-2">
        {results.map((r) => (
          <li
            key={`${r.mediaType}-${r.tmdbId}`}
            className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
          >
            <Poster path={r.posterPath} alt={r.title} width={56} height={84} size="w185" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium">{r.title}</span>
                {r.year && <span className="text-xs text-[var(--color-muted)]">{r.year}</span>}
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                  {r.mediaType === "tv" ? "TV" : "Movie"}
                </span>
              </div>
              {r.overview && <p className="line-clamp-2 text-xs text-[var(--color-muted)]">{r.overview}</p>}
              <div className="mt-auto pt-1">
                <AddButton result={r} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
