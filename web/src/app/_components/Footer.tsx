import Image from "next/image";
import { isTvdbConfigured } from "@/lib/tvdb";
import { FooterNav } from "./FooterNav";

// Site footer, shared by every page (design reference). Left: TheTVDB attribution logo (their terms require a
// credit + direct link wherever TVDB metadata is shown — the footer covers every page). Right: the Credits link
// (the mandatory TMDB attribution lives on that page) and, for the signed-in owner, Sign out.
export function Footer({ isOwner }: { isOwner: boolean }) {
  return (
    <footer className="border-t border-[#1c1c22]">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-4 px-7 py-[18px] text-xs text-[var(--color-faint)]">
        {isTvdbConfigured() && (
          <a
            href="https://www.thetvdb.com"
            target="_blank"
            rel="noreferrer"
            title="Metadata provided by TheTVDB"
            className="inline-flex opacity-80 transition-opacity hover:opacity-100"
          >
            <Image
              src="/thetvdb.png"
              alt="Metadata provided by TheTVDB"
              width={400}
              height={216}
              className="block h-[26px] w-auto"
            />
          </a>
        )}
        <FooterNav isOwner={isOwner} />
      </div>
    </footer>
  );
}
