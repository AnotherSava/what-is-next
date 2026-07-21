import type { CastMember } from "@/lib/cast";
import { posterUrl } from "@/lib/images";
import { CastAvatar } from "./CastAvatar";

// The "Top cast" grid shared by the movie and show detail pages (single source of logic — the two must stay
// visually identical). Renders up to `limit` billed cast members as portrait + name + character; the portrait
// degrades to initials when there's no photo or it fails to load (see CastAvatar). Renders nothing when the cast
// is empty, so a page can drop it in unconditionally.
export function TopCast({ cast, limit = 8 }: { cast: CastMember[]; limit?: number }) {
  const members = cast.slice(0, limit);
  if (members.length === 0) return null;
  return (
    <section className="mt-[34px]">
      <h2 className="font-display mb-[18px] text-[18px] font-bold">Top cast</h2>
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((c, i) => (
          <div key={`${c.name}-${i}`} className="flex min-w-0 items-center gap-4">
            <CastAvatar name={c.name} photo={posterUrl(c.profilePath, "w185")} />
            <div className="min-w-0">
              <div className="font-display text-[15.5px] leading-[1.25] font-semibold text-pretty">{c.name}</div>
              {c.character && <div className="font-narrow mt-[3px] truncate text-[14px] text-[var(--color-muted)]">{c.character}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
