import Link from "next/link";
import { BrandLink } from "./BrandLink";
import { GearLink } from "./GearLink";
import { GridDensitySlider } from "./GridDensity";
import { NavLinks } from "./NavLinks";
import { SyncPill } from "./FreshnessDot";

// Top navigation (design reference). Left: the brand mark (home) + a divider + the content destinations. Right: the
// poster-grid density slider, the Plex "Synced" pill, and a gear that opens Settings (Admin). Matches the reference
// chrome — Lists is reachable by URL but not in the nav; Search sits at the end as an owner-only destination.
// Owner-only destinations (Download, Search) and the gear/Synced controls appear only for the owner; the routes are
// still guarded server-side.
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
    // Download surfaces what to acquire for your own Plex library, and Search adds new titles — both owner utilities,
    // not viewer content.
    ...(isOwner ? [{ href: "/download", label: "Download" }, { href: "/search", label: "Search" }] : []),
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
            <GearLink />
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
