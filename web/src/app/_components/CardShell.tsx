import type { ReactNode } from "react";

// The shared poster-grid card frame — a bordered, rounded, drop-shadowed surface carrying the hover wiring
// (.wn-posterwrap / .wn-card). Every card (PosterCard, SearchCard, PersonCard) wraps its media + body in this so
// the frame can't drift between them. Presentational — safe to render from both server and client cards.
export function CardShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="wn-posterwrap wn-card relative overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 16px 38px -22px rgba(0,0,0,0.85)" }}
    >
      {children}
    </div>
  );
}
