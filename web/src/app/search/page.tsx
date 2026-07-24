import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "@/app/_components/cardUi";
import { getPrisma } from "@/lib/db";
import { searchCatalog, tmdbErrorMessage, type SearchOutcome, type SearchScope } from "@/lib/search";
import { getSessionUser } from "@/lib/session";
import { getTmdb } from "@/lib/tmdb";
import { PersonCard } from "./_components/PersonCard";
import { SearchCard } from "./_components/SearchCard";
import { SearchControls } from "./_components/SearchControls";

export const metadata: Metadata = { title: "Search" };

const SCOPES: SearchScope[] = ["movie", "show", "person"];
const asScope = (v: string | undefined): SearchScope => (SCOPES.includes(v as SearchScope) ? (v as SearchScope) : "movie");

// A search param may arrive repeated (?q=a&q=b → string[]); collapse to the first value before use.
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; scope?: string | string[] }>;
}) {
  // Search-to-add is an owner-only affordance (brief §8.5) — viewers are bounced.
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/");

  const { q, scope: scopeParam } = await searchParams;
  const scope = asScope(first(scopeParam));
  const query = (first(q) ?? "").trim();

  let outcome: SearchOutcome | null = null;
  let error: string | null = null;
  if (query) {
    try {
      // getTmdb is passed as a factory (not a client) so a missing-token construction failure is caught inside
      // searchCatalog alongside fetch errors — the tracked-library results still come back for movie/show scopes.
      outcome = await searchCatalog(getPrisma(), getTmdb, { query, scope, userId: sessionUser.id });
      error = outcome.error;
    } catch (e) {
      error = tmdbErrorMessage(e);
    }
  }

  const hasResults = outcome
    ? outcome.scope === "person"
      ? outcome.people.length > 0
      : outcome.results.length > 0
    : false;

  return (
    <div>
      <PageTitle>Search</PageTitle>
      <div className="mt-5">
        <SearchControls scope={scope} query={query} />
      </div>

      {!query && (
        <p className="py-[30px] text-center text-sm text-[var(--color-faint)]">
          Enter a keyword to search your library and the wider catalog.
        </p>
      )}

      {error && <p className="mb-[18px] text-[13px] text-[#e0808a]">{error}</p>}

      {outcome && outcome.scope !== "person" && outcome.results.length > 0 && (
        <div className="wn-grid">
          {outcome.results.map((r) => (
            <SearchCard key={r.key} result={r} />
          ))}
        </div>
      )}

      {outcome && outcome.scope === "person" && outcome.people.length > 0 && (
        <div className="wn-grid">
          {outcome.people.map((p) => (
            <PersonCard key={p.key} person={p} />
          ))}
        </div>
      )}

      {outcome && !error && !hasResults && (
        <p className="py-[8px] text-sm text-[var(--color-faint)]">No results found.</p>
      )}
    </div>
  );
}
