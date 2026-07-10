import Image from "next/image";
import Link from "next/link";
import { logout } from "@/app/_actions/auth";
import { isTvdbConfigured } from "@/lib/tvdb";

// Site footer, shared by every page. Left: TheTVDB attribution logo (their terms require a credit + direct link
// wherever TVDB metadata is shown — the footer covers every page). Right: the Credits link (the mandatory TMDB
// attribution lives on that page) and, for the signed-in owner, Sign out.
export function Footer({ isOwner }: { isOwner: boolean }) {
  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 text-xs text-[var(--color-muted)]">
        {isTvdbConfigured() && (
          <a
            href="https://www.thetvdb.com"
            target="_blank"
            rel="noreferrer"
            title="Metadata provided by TheTVDB"
            className="inline-block opacity-70 transition-opacity hover:opacity-100"
          >
            <Image
              src="/thetvdb.png"
              alt="Metadata provided by TheTVDB"
              width={400}
              height={216}
              className="h-6 w-auto"
            />
          </a>
        )}
        <div className="ml-auto flex items-center gap-4">
          <Link href="/credits" className="hover:text-[var(--color-text)]">
            Credits
          </Link>
          {isOwner && (
            <form action={logout}>
              <button type="submit" className="hover:text-[var(--color-text)]">
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
    </footer>
  );
}
