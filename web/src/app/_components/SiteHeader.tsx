import Link from "next/link";
import { BrandLink } from "./BrandLink";
import { GridDensitySlider } from "./GridDensity";
import { NavLinks } from "./NavLinks";
import { SyncPill } from "./FreshnessDot";

// Top navigation (design reference). Left: the brand mark (home) + a divider + the content destinations. Right: the
// poster-grid density slider, the Plex "Synced" pill, and a gear that opens Settings (Admin). Matches the reference
// chrome exactly — Lists and Search are reachable by URL but no longer sit in the nav. Owner-only destinations
// (Download) and the gear/Synced controls appear only for the owner; the routes are still guarded server-side.
export function SiteHeader({
  isOwner,
  freshness,
}: {
  isOwner: boolean;
  freshness: { lastSyncAt: string; staleThresholdMs: number } | null;
}) {
  const links: { href: string; label: string }[] = [
    { href: "/shows", label: "Shows" },
    { href: "/movies", label: "Movies" },
    { href: "/recent", label: "Recent" },
    // Download surfaces what to acquire for your own Plex library — an owner utility, not viewer content.
    ...(isOwner ? [{ href: "/download", label: "Download" }] : []),
  ];
  return (
    <header
      className="sticky top-0 z-40 border-b border-[var(--color-border)]"
      style={{ background: "rgba(9,9,11,0.82)", backdropFilter: "blur(12px)" }}
    >
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2 px-7 py-[11px]">
        <BrandLink />
        <span className="mx-1.5 h-[18px] w-px bg-[var(--color-surface-2)]" />
        <NavLinks items={links} />
        <span className="ml-auto flex items-center gap-4">
          <GridDensitySlider />
          <span className="h-[18px] w-px bg-[var(--color-surface-2)]" />
          {isOwner && freshness && (
            <SyncPill lastSyncAt={freshness.lastSyncAt} staleThresholdMs={freshness.staleThresholdMs} />
          )}
          {isOwner ? (
            <Link href="/admin" aria-label="Settings" title="Settings" className="flex items-center">
              <svg
                className="wn-gear"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-faint)"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
          ) : (
            <Link
              href="/login"
              className="wn-nav flex h-[22px] items-center rounded-lg px-2.5 text-[13px] font-medium text-[var(--color-muted)]"
            >
              Sign in
            </Link>
          )}
        </span>
      </div>
    </header>
  );
}
