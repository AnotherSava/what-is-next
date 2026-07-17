// The freshness readout shown beside each job's "run now" button (e.g. "up to date · 3m ago", "18 errors · 3m ago").
// Shared so the static job cards and the live-refreshing button render an identical badge on the button's own line —
// the badge must never sit below the button, or a long progress title would push it around. `title` is pre-formatted
// on the server (the absolute timestamp) so this stays a pure, hydration-safe presentational component.
export const FRESHNESS_CLASS = "whitespace-nowrap font-num text-[12px] font-semibold tabular-nums";

export function FreshnessBadge({ text, color, title }: { text: string; color: string; title?: string }) {
  return (
    <span className={FRESHNESS_CLASS} style={{ color }} title={title}>
      {text}
    </span>
  );
}
