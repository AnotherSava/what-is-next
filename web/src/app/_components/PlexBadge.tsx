// Plex UI affordances (Plex integration):
//   • `dot`  — a compact solid-gold (#e5a00d) "in Plex" presence marker, used per-season in the episode checklist.
//   • `href` — a small round "watch in Plex" play button: a play triangle in a chip, neutral at rest (muted
//              triangle on a surface chip) and revealing Plex gold only on hover; opens the item's page in the
//              Plex web app in a new tab. Used on cards/headers wherever an in-Plex item can be launched.
// With neither prop there's nothing to show.
export function PlexBadge({ dot = false, href, className = "" }: { dot?: boolean; href?: string; className?: string }) {
  if (dot) {
    return (
      <span
        title="In your Plex library"
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#e5a00d] ${className}`}
        aria-label="In Plex"
      />
    );
  }
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Watch in Plex"
        aria-label="Watch in Plex"
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] transition hover:bg-[#e5a00d]/15 hover:text-[#e5a00d] ${className}`}
      >
        {/* Equilateral triangle whose 3 vertices are all radius 7 from the viewBox centre (12,12) — so it sits
            optically centred in the round chip, no nudge needed. Angles 0°/±120°: (19,12), (8.5,18.06), (8.5,5.94). */}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden focusable="false">
          <path d="M19 12 8.5 18.06 8.5 5.94Z" />
        </svg>
      </a>
    );
  }
  return null;
}
