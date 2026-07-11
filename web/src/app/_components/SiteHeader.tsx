import Link from "next/link";
import { FreshnessDot } from "./FreshnessDot";

// Top navigation, shared by viewer and owner renders. Content destinations sit on the left; the owner's Admin
// console + Sign in sit on the right (Sign out lives in the footer). Owner-only destinations (Search adds
// catalog rows; Admin runs refresh/backups/Plex sync) appear only when isOwner — but that's UX; the routes
// themselves are guarded server-side (proxy.ts for /admin, requireOwner() in each action).
//
// freshness (owner + Plex configured only) drives the little dot beside Admin: how current the Plex-synced watch
// data on the page is. Null when there's nothing to report (no Plex, or never synced).
export function SiteHeader({
  isOwner,
  freshness,
}: {
  isOwner: boolean;
  freshness: { lastSyncAt: string; staleThresholdMs: number } | null;
}) {
  const links: { href: string; label: string }[] = [
    { href: "/", label: "Watch next" },
    { href: "/shows", label: "Shows" },
    { href: "/movies", label: "Movies" },
    { href: "/recent", label: "Recently watched" },
    { href: "/lists", label: "Lists" },
    ...(isOwner ? [{ href: "/search", label: "Search" }] : []),
  ];
  const itemClass =
    "rounded-md px-2.5 py-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]";
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur">
      <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3 text-sm">
        <Link href="/" className="mr-2 font-semibold tracking-tight">
          What&rsquo;s next
        </Link>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={itemClass}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {isOwner ? (
            <>
              {freshness && (
                <FreshnessDot lastSyncAt={freshness.lastSyncAt} staleThresholdMs={freshness.staleThresholdMs} />
              )}
              <Link href="/admin" className={itemClass}>
                Admin
              </Link>
            </>
          ) : (
            <Link href="/login" className={itemClass}>
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
