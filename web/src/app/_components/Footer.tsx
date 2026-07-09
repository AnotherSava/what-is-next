import Link from "next/link";
import { logout } from "@/app/_actions/auth";

// Site footer, shared by every page. Carries the mandatory TMDB attribution (brief §4) and the discreet
// owner sign-in / sign-out affordance (§8). A viewer sees "Sign in"; the owner sees Admin + Sign out.
// TODO(phase6): add the official TMDB logo asset (public/tmdb.svg) next to the notice — text alone satisfies
// the wording, but TMDB's brand guidelines also want the logo.
export function Footer({ isOwner }: { isOwner: boolean }) {
  return (
    <footer className="mt-16 border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 text-xs text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md leading-relaxed">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <div className="flex items-center gap-4">
          {isOwner ? (
            <>
              <Link href="/admin" className="hover:text-[var(--color-text)]">
                Admin
              </Link>
              <form action={logout}>
                <button type="submit" className="hover:text-[var(--color-text)]">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="hover:text-[var(--color-text)]">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
