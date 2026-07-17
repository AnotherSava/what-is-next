import type { ReactNode } from "react";

// One stat: a muted label and a bright value, laid out as its own row.
export type Stat = { value: number | string; label: string };

// Render a relative-time string ("11m ago") with a 0.1em gap between the number and its unit; non-numeric values
// ("just now") render unchanged.
function TimeAgo({ text }: { text: string }) {
  const m = text.match(/^(\d+)(.*)$/);
  if (!m) return <>{text}</>;
  return (
    <>
      <span style={{ marginRight: "0.1em" }}>{m[1]}</span>
      {m[2]}
    </>
  );
}

// The last run's outcome under a job's button. Heading row: "<verb> <when>" (verb muted, time bright) with the
// run duration faint on the right; the body below is the caller's — <StatRows> for Refresh/Sync, or the file rows
// for Backup. Server-rendered from stored last-run bookkeeping, so the relative time refreshes on re-render.
export function RunResult({
  verb,
  when,
  duration,
  children,
}: {
  verb: string;
  when: string;
  duration?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-num text-[13px] font-medium text-[var(--color-muted)]">{verb}</span>
        <span className="font-num text-[13px] font-semibold tabular-nums text-[var(--color-text)]">
          <TimeAgo text={when} />
        </span>
        {duration && (
          <span className="ml-auto font-num text-[13px] tabular-nums text-[var(--color-faint)]">{duration}</span>
        )}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

// Run stats as full-width rows: muted label on the left, bright bold value on the right, with a subtle zebra stripe
// on alternate rows so the columns are easy to scan.
export function StatRows({ stats }: { stats: Stat[] }) {
  return (
    <div className="font-num text-[12.5px] tabular-nums">
      {stats.map((s, i) => (
        <div
          key={i}
          className="-mx-2 flex items-baseline justify-between rounded-md px-2 py-[3px] leading-[1.75]"
          style={i % 2 === 0 ? { background: "rgba(255,255,255,0.015)" } : undefined}
        >
          <span className="text-[var(--color-muted)]">{s.label}</span>
          <span className="font-semibold text-[var(--color-text)]">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
