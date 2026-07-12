// A titled list section with a count pill — the shared heading for the Watch-next and Download columns.
export function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs">{count}</span>
      </h2>
      {children}
    </section>
  );
}
