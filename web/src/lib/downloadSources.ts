// The external "search this title on a download source" links shown on the Download view. Each source's whole URL
// — domain, path, and any query params — is owner-configured app config (the Setting store, edited on the admin
// page), never committed, so no download-source details live in the repo. A source targets movie cards, show
// cards, or both; its template carries a {query} placeholder replaced with the URL-encoded title. The chip label
// is the admin's custom text, or the template's host derived at runtime when they leave it blank.

const DOWNLOAD_QUERY_PLACEHOLDER = "{query}";

export interface DownloadSource {
  label: string; // display text for the chip; "" → fall back to the template's host
  template: string; // full URL including the {query} placeholder
  movies: boolean; // show this link on movie cards
  shows: boolean; // show this link on show cards
}

export interface DownloadLink {
  label: string;
  href: string;
}

// Normalize a source list for persistence: trim the text fields and drop rows with no template. PURE. Shared by
// the admin editor (to sync its local state to what's saved) and the server action (the authoritative write) so
// the two can't drift.
export function cleanDownloadSources(sources: DownloadSource[]): DownloadSource[] {
  return sources
    .map((s) => ({ label: s.label.trim(), template: s.template.trim(), movies: s.movies, shows: s.shows }))
    .filter((s) => s.template);
}

// Search links for one title on every configured source that targets the given card kind. PURE. Sources with an
// unusable template — blank, not an absolute http(s) URL, or missing the {query} placeholder — are skipped, so a
// half-filled admin row never renders a broken link.
export function downloadLinksFor(sources: DownloadSource[], kind: "movies" | "shows", title: string): DownloadLink[] {
  const links: DownloadLink[] = [];
  for (const source of sources) {
    if (!source[kind]) continue;
    const href = buildSearchUrl(source.template, title);
    if (href) links.push({ label: sourceLabel(source), href });
  }
  return links;
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
