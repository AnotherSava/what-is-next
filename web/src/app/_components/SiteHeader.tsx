import Link from "next/link";
import { logout } from "@/app/_actions/auth";

// Top navigation, shared by viewer and owner renders. Content destinations sit on the left; account/owner
// affordances (Admin console, Sign in / Sign out) sit on the right. Owner-only destinations (Search adds
// catalog rows; Admin runs refresh/import/backups) appear only when isOwner — but that's UX; the routes
// themselves are guarded server-side (proxy.ts for /admin, requireOwner() in each action).
export function SiteHeader({ isOwner }: { isOwner: boolean }) {
  const links: { href: string; label: string }[] = [
    { href: "/", label: "Watch next" },
    { href: "/shows", label: "Shows" },
    { href: "/movies", label: "Movies" },
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
        <div className="flex items-center gap-1">
          {isOwner ? (
            <>
              <Link href="/admin" className={itemClass}>
                Admin
              </Link>
              <form action={logout}>
                <button type="submit" className={itemClass}>
                  Sign out
                </button>
              </form>
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
