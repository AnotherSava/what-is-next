// Small presentation helpers shared across pages.

// Render a count with its noun, pluralized. Pass an explicit plural form for irregular nouns (e.g.
// plural(n, "watch", "watches")); regular nouns default to singular + "s".
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// Compact single-unit elapsed interval (largest unit only): "5m" / "3h" / "12d". Floors to the unit; clamps to a
// minimum of "1m" (a sub-minute, zero, or negative interval reads "1m", never "0m"). No seconds; days are unbounded
// (a year reads "365d"). Bare magnitude — callers append "ago"/"left" as context needs. (Matches printlab's timer.)
export function formatInterval(ms: number): string {
  const min = Math.floor((ms > 0 ? ms : 0) / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
