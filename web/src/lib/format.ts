// Small presentation helpers shared across pages.

// Render a count with its noun, pluralized. Pass an explicit plural form for irregular nouns (e.g.
// plural(n, "watch", "watches")); regular nouns default to singular + "s".
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// A job duration in whole-tenths of a second: "3.2s". For the sub-minute elapsed times the nightly jobs report.
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Compact season list from season numbers (deduped + sorted here): "Season 2", "Seasons 2-4", "Seasons 1, 3-5".
// Contiguous runs collapse to A-B; the noun is singular only for a single season. Empty input → "".
export function formatSeasonRange(seasons: number[]): string {
  const sorted = [...new Set(seasons)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  return `${sorted.length === 1 ? "Season" : "Seasons"} ${parts.join(", ")}`;
}

// A movie runtime in minutes as "2h 46m" (or "46m" under an hour). Null/zero → "" so the card omits it cleanly.
export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Compact single-unit elapsed interval (largest unit only): "5m" / "3h" / "12d" / "4mo" / "2y". Floors to the
// unit; clamps to a minimum of "1m" (a sub-minute, zero, or negative interval reads "1m", never "0m"). No seconds.
// Months use "mo" (two letters) so they never collide with minutes' "m" — case alone (m vs M) is too easy to
// misread. A month is approximated as 30 days and a year as 365; the floor guards mean months land in 1mo–12mo
// and years never read "0y". Bare magnitude — callers append "ago"/"left" as context needs.
export function formatInterval(ms: number): string {
  const min = Math.floor((ms > 0 ? ms : 0) / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
