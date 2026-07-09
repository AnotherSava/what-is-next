// Site footer, shared by every page. Carries the mandatory TMDB attribution (brief §4) and — when the TVDB
// fallback is enabled — TheTVDB attribution its API terms require. The owner sign-in / sign-out and Admin
// affordances (§8) live in the top nav (SiteHeader), so the footer is content-only.
// TODO(phase6): add the official TMDB logo asset (public/tmdb.svg) next to the notice — text alone satisfies
// the wording, but TMDB's brand guidelines also want the logo.
export function Footer({ showTvdb }: { showTvdb: boolean }) {
  return (
    <footer className="mt-16 border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-4xl space-y-1 px-4 py-6 text-xs text-[var(--color-muted)]">
        <p className="max-w-md leading-relaxed">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        {showTvdb && (
          <p className="max-w-md leading-relaxed">
            Additional metadata provided by{" "}
            <a
              href="https://www.thetvdb.com/"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:text-[var(--color-text)]"
            >
              TheTVDB
            </a>
            .
          </p>
        )}
      </div>
    </footer>
  );
}
