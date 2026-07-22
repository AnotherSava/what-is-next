"use client";

import { HeroKebabMenu } from "@/app/_components/HeroKebabMenu";
import { removeShowFromTracking } from "../actions";

// The show hero's ⋯ actions menu (owner-only; the page renders it only when the show is tracked, so the menu always
// has its one item). The disclosure mechanics live in the shared HeroKebabMenu; this only supplies the item — a
// single, context-dependent one: "Stop tracking" when anything is watched (keeps the watch log; the show stays
// under "Stopped"), else "Remove from tracking" (a full untrack, styled danger like the movie one). The server
// re-derives which case applies, so a stale label is safe.
export function ShowHeroMenu({ showId, hasWatches }: { showId: string; hasWatches: boolean }) {
  return (
    <HeroKebabMenu
      items={[
        {
          label: hasWatches ? "Stop tracking" : "Remove from tracking",
          danger: !hasWatches,
          action: () => removeShowFromTracking(showId),
        },
      ]}
    />
  );
}
