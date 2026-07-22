import { CastAvatar } from "@/app/_components/CastAvatar";
import type { CastMember } from "@/lib/cast";
import { posterUrl } from "@/lib/images";

// The show detail page's right-rail "Top cast" — a single vertical column of smaller (52px) portraits, distinct
// from the movie page's wide 3-column grid (TopCast). Shares the fallback-initials avatar (CastAvatar) so a missing
// or broken photo degrades identically. Renders nothing when the cast is empty, so the page can drop it in blind.
export function CastColumn({ cast, limit = 10 }: { cast: CastMember[]; limit?: number }) {
  const members = cast.slice(0, limit);
  if (members.length === 0) return null;
  return (
    <section className="w-full shrink-0 md:w-[290px]">
      <h2 className="font-display mb-4 text-[18px] font-bold">Top cast</h2>
      <div className="flex flex-col gap-[15px]">
        {members.map((c, i) => (
          <div key={`${c.name}-${i}`} className="cast-row flex min-w-0 items-center gap-[14px]">
            <CastAvatar name={c.name} photo={posterUrl(c.profilePath, "w185")} size={52} />
            <div className="min-w-0 flex-1">
              <div className="cast-name font-display truncate text-[14.5px] leading-[1.25] font-semibold transition-colors">{c.name}</div>
              {c.character && <div className="font-narrow mt-[2px] truncate text-[13px] text-[var(--color-muted)]">{c.character}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
