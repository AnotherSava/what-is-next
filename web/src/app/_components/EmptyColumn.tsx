// A muted placeholder for an empty column on the two-column Watch-next and Download pages — keeps a column's
// slot labelled and balanced when it has nothing to show, rather than collapsing the grid.
export function EmptyColumn({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
      {children}
    </p>
  );
}
