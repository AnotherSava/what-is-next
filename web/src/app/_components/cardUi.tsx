import type { ReactNode } from "react";

// Presentational building blocks shared by every poster-grid view (design reference), so headings and card text
// read identically wherever they appear and can't drift between pages. Plain markup — safe to import from both
// server and client components.

// Page heading — the big title at the top of Shows / Movies / Recent / Download / Settings / Credits.
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-[32px] font-bold tracking-[-0.02em]">{children}</h1>;
}

// Home's lighter section heading ("Shows", "Movies") — no dot.
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[19px] font-bold">{children}</h2>;
}

// A grouped-shelf heading: a small square colour dot + label (+ optional count), above a poster grid.
export function GroupHeading({ color, label, count }: { color: string; label: string; count?: number }) {
  return (
    <div className="mb-[15px] flex items-center gap-[10px]">
      <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: color }} />
      <span className="font-display text-[16px] font-semibold">{label}</span>
      {count != null && <span className="font-num text-[13px] tabular-nums text-[var(--color-faint)]">{count}</span>}
    </div>
  );
}

// The card's title row: bold title (truncates) with an optional muted aside pinned right (a year, "N ago", …).
export function CardTitle({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-display truncate text-[15px] font-bold">{title}</span>
      {aside != null && aside !== "" && (
        <span className="shrink-0 font-num text-[11px] tabular-nums text-[var(--color-faint)]">{aside}</span>
      )}
    </div>
  );
}

// A generic sub-row: narrow left text (director / season range) with an optional tabular value pinned right.
export function CardMetaRow({
  left,
  leftColor = "var(--color-muted)",
  right,
}: {
  left: ReactNode;
  leftColor?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mt-[3px] flex items-baseline justify-between gap-2">
      <span className="font-narrow min-w-0 truncate text-[13px]" style={{ color: leftColor }}>
        {left}
      </span>
      {right != null && right !== "" && (
        <span className="shrink-0 font-num text-[11px] tabular-nums text-[var(--color-faint)]">{right}</span>
      )}
    </div>
  );
}
