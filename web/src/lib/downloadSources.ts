// The external "search this title on a download source" links shown on the Download view. Each source's whole URL
// — domain, path, and any query params — is owner-configured app config (the Setting store, edited on the admin
// page), never committed, so no download-source details live in the repo. A source targets movie cards, show
// cards, or both; its template carries a {query} placeholder replaced with the URL-encoded title. Each source also
// carries the LANGUAGE its queries are worded in (which title gets searched) and the SEASON FORMAT appended to a
// show's per-season link. The chip label is the admin's custom text, or the template's host derived at runtime
// when they leave it blank.

const DOWNLOAD_QUERY_PLACEHOLDER = "{query}";

// The language a source searches in when none is configured — also what a blank/legacy stored value means. The
// catalog's `title` is TMDB's English title, so English is both the default and the universal fallback.
export const DEFAULT_LANGUAGE = "en";

// Season markers are printf-shaped: %d is the plain number, %0Nd zero-pads it, %% is a literal percent. Anything
// else is left alone, so a pattern is mostly literal text ("Сезон %d" → "Сезон 5", "S%02d" → "S05").
const SEASON_TOKEN = /%%|%0(\d+)d|%d/g;

// What a source appends for a season link when nothing else is configured — also what rows saved before season
// patterns existed get, so their links keep the exact "Severance S02" shape they had.
export const DEFAULT_SEASON_PATTERN = "S%02d";

export interface DownloadSource {
  label: string; // display text for the chip; "" → fall back to the template's host
  template: string; // full URL including the {query} placeholder
  movies: boolean; // show this link on movie cards
  shows: boolean; // show this link on show cards
  language: string; // ISO 639-1 code of the title to search with; "en" (the default) uses the English title
  seasonPattern: string; // season marker appended to a show search ("S%02d", "Сезон %d"); blank → no marker
}

export interface DownloadLink {
  label: string;
  href: string;
}

// One entry in the admin's search-language picker. The list itself is built per request from the catalog — see
// lib/searchLanguages.ts — so this only carries what the editor renders.
export interface LanguageOption {
  code: string;
  name: string;
}

// The title fields a search query can be built from — MediaItem's English `title` plus its native one. Structural,
// so any view model carrying these three (ShowDetail, DownloadMovie, …) can be passed straight in.
export interface SearchTitle {
  title: string; // TMDB's English title — the fallback for every language we have no native title for
  originalTitle: string | null; // the title in `originalLanguage`
  originalLanguage: string | null; // TMDB original_language code, mostly ISO 639-1
}

// Normalize a source list for persistence: trim the text fields and drop rows with no template. PURE. Shared by
// the admin editor (to sync its local state to what's saved) and the server action (the authoritative write) so
// the two can't drift.
export function cleanDownloadSources(sources: DownloadSource[]): DownloadSource[] {
  return sources
    .map((s) => ({
      label: s.label.trim(),
      template: s.template.trim(),
      movies: s.movies,
      shows: s.shows,
      language: normalizeLanguage(s.language),
      seasonPattern: s.seasonPattern.trim(),
    }))
    .filter((s) => s.template);
}

// Search links for one title on every configured source that targets the given card kind. PURE. Each source
// searches in ITS configured language, so a Russian tracker gets the Russian title while an English one gets the
// English title of the same item. Pass `season` for a per-season link: the source's own season marker is appended,
// whichever title the query ended up using — a tracker indexes its seasons one way regardless of how a given show
// is titled there. Sources with an unusable template — blank, not an absolute http(s) URL, or missing the {query}
// placeholder — are skipped, so a half-filled admin row never renders a broken link.
export function downloadLinksFor(
  sources: DownloadSource[],
  kind: "movies" | "shows",
  item: SearchTitle,
  season?: number,
): DownloadLink[] {
  const links: DownloadLink[] = [];
  for (const source of sources) {
    if (!source[kind]) continue;
    const title = searchTitleFor(item, source.language);
    const marker = season != null && source.seasonPattern ? formatSeason(source.seasonPattern, season) : "";
    const href = buildSearchUrl(source.template, marker ? `${title} ${marker}` : title);
    if (href) links.push({ label: sourceLabel(source), href });
  }
  return links;
}

// The title to search a source with: the item's native title when that's the language the source wants, else the
// English one. We only ever hold the two titles TMDB gives us (English + original), so any other language — and
// any item whose original title we never resolved — falls back to English rather than guessing a translation.
function searchTitleFor(item: SearchTitle, language: string): string {
  const wanted = normalizeLanguage(language);
  if (wanted === DEFAULT_LANGUAGE) return item.title;
  const original = item.originalLanguage?.trim().toLowerCase();
  return original === wanted && item.originalTitle ? item.originalTitle : item.title;
}

// A season pattern with its number filled in. PURE, and total: a pattern with no token at all is just literal
// text, so a malformed one degrades to a fixed suffix rather than throwing or dropping the link.
function formatSeason(pattern: string, season: number): string {
  return pattern.replace(SEASON_TOKEN, (match, width?: string) =>
    match === "%%" ? "%" : String(season).padStart(width ? Number(width) : 0, "0"),
  );
}

// A stored language code in canonical form. Blank covers both "left empty in the editor" and rows saved before
// the field existed; both mean English. Exported so the picker builder canonicalizes identically — the editor
// looks a saved code up in the offered list by equality, so any drift there would relabel a configured source.
export function normalizeLanguage(language: string | null | undefined): string {
  return language?.trim().toLowerCase() || DEFAULT_LANGUAGE;
}

// Substitute the URL-encoded title into the placeholder, or null when the template can't yield a usable link. The
// title is percent-encoded (spaces → %20, & → %26) so it can never break out of the query string.
function buildSearchUrl(template: string, title: string): string | null {
  if (!/^https?:\/\//i.test(template) || !template.includes(DOWNLOAD_QUERY_PLACEHOLDER)) return null;
  return template.replaceAll(DOWNLOAD_QUERY_PLACEHOLDER, encodeURIComponent(title));
}

// The chip label: the admin's custom label, or the template host (minus a leading "www.") when it's left blank.
// Also reused by the admin editor's read-only row so its label matches exactly what the card chip shows.
export function sourceLabel(source: DownloadSource): string {
  const custom = source.label.trim();
  if (custom) return custom;
  try {
    return new URL(source.template).hostname.replace(/^www\./, "");
  } catch {
    return "Search";
  }
}
