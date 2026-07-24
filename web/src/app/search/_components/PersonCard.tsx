import { CardShell } from "@/app/_components/CardShell";
import { PosterImage } from "@/app/_components/PosterImage";
import { CardTitle } from "@/app/_components/cardUi";
import type { PersonResult } from "@/lib/search";

// A person search result (design reference "Search" screen, Person scope): a display-only card — photo, name, and
// a role sub-line ("Actor · Known for …"). People aren't tracked, so the card is inert (no link, no add).
export function PersonCard({ person }: { person: PersonResult }) {
  return (
    <CardShell>
      <div className="wn-postermedia relative aspect-[2/3] overflow-hidden">
        <PosterImage path={person.profilePath} alt={person.name} />
      </div>
      <div className="px-[13px] pt-3 pb-[13px]">
        <CardTitle title={person.name} />
        {person.role && (
          <div className="font-narrow mt-[3px] truncate text-[13px] text-[var(--color-muted)]">{person.role}</div>
        )}
      </div>
    </CardShell>
  );
}
