import { describe, expect, it } from "vitest";
import {
  compareEpisodes,
  computeShowProgress,
  displayGroup,
  hasAired,
  isEndedStatus,
  watchedEpisodeIds,
  type DerivedStatus,
  type ProgressEpisode,
  type ShowProgress,
} from "./progress";

const TODAY = "2026-07-08";

// Terse episode builder. Defaults: aired last year, not special.
function ep(
  id: string,
  seasonNumber: number,
  episodeNumber: number,
  opts: { releaseDate?: string | null; isSpecial?: boolean } = {},
): ProgressEpisode {
  return {
    id,
    seasonNumber,
    episodeNumber,
    isSpecial: opts.isSpecial ?? false,
    releaseDate: opts.releaseDate === undefined ? "2025-01-01" : opts.releaseDate,
  };
}
const seen = (...ids: string[]) => ids.map((episodeId) => ({ episodeId }));

describe("hasAired", () => {
  it("true on or before today, false after or when undated", () => {
    expect(hasAired("2025-01-01", TODAY)).toBe(true);
    expect(hasAired(TODAY, TODAY)).toBe(true);
    expect(hasAired("2099-01-01", TODAY)).toBe(false);
    expect(hasAired(null, TODAY)).toBe(false);
    expect(hasAired(undefined, TODAY)).toBe(false);
  });
  it("tolerates a full ISO datetime by comparing the date part", () => {
    expect(hasAired("2025-01-01T20:00:00Z", TODAY)).toBe(true);
  });
});

describe("isEndedStatus", () => {
  it("only Ended/Canceled/Cancelled are ended", () => {
    for (const s of ["Ended", "Canceled", "Cancelled"]) expect(isEndedStatus(s)).toBe(true);
    for (const s of ["Returning Series", "In Production", "Planned", "Pilot", null, undefined]) {
      expect(isEndedStatus(s)).toBe(false);
    }
  });
});

describe("watchedEpisodeIds", () => {
  it("collects non-null episode ids and dedupes rewatches", () => {
    const ids = watchedEpisodeIds([{ episodeId: "a" }, { episodeId: "a" }, { episodeId: null }, { episodeId: "b" }]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("compareEpisodes", () => {
  it("orders by season then episode", () => {
    expect(compareEpisodes(ep("x", 1, 2), ep("y", 1, 3))).toBeLessThan(0);
    expect(compareEpisodes(ep("x", 2, 1), ep("y", 1, 9))).toBeGreaterThan(0);
    expect(compareEpisodes(ep("x", 1, 1), ep("y", 1, 1))).toBe(0);
  });
});

describe("computeShowProgress — status", () => {
  it("behind when ≥1 aired, unwatched, non-special episode", () => {
    const episodes = [ep("s1e1", 1, 1), ep("s1e2", 1, 2)];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e1"),
      airingStatus: "Returning Series",
      todayISO: TODAY,
    });
    expect(p.status).toBe("behind");
    expect(p.unwatchedAiredCount).toBe(1);
    expect(p.nextUp?.id).toBe("s1e2");
  });

  it("up-to-date when caught up and show still expects more", () => {
    const episodes = [ep("s1e1", 1, 1), ep("s1e2", 1, 2)];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e1", "s1e2"),
      airingStatus: "Returning Series",
      todayISO: TODAY,
    });
    expect(p.status).toBe("up-to-date");
    expect(p.nextUp).toBeNull();
    expect(p.unwatchedAiredCount).toBe(0);
  });

  it("finished when caught up and show is Ended", () => {
    const episodes = [ep("s1e1", 1, 1)];
    const p = computeShowProgress({ episodes, seenEvents: seen("s1e1"), airingStatus: "Ended", todayISO: TODAY });
    expect(p.status).toBe("finished");
  });

  it("caught up + unknown/null status → up-to-date, not finished", () => {
    const episodes = [ep("s1e1", 1, 1)];
    const p = computeShowProgress({ episodes, seenEvents: seen("s1e1"), airingStatus: null, todayISO: TODAY });
    expect(p.status).toBe("up-to-date");
  });
});

describe("computeShowProgress — exclusions", () => {
  it("excludes specials from counts and never makes you behind on them", () => {
    const episodes = [
      ep("special", 0, 1, { isSpecial: true }), // aired, unwatched special
      ep("s1e1", 1, 1),
    ];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e1"),
      airingStatus: "Ended",
      todayISO: TODAY,
    });
    expect(p.status).toBe("finished"); // the unwatched special doesn't count
    expect(p.totalCounted).toBe(1);
    expect(p.nextUp).toBeNull();
  });

  it("excludes not-yet-aired episodes from the behind calculation", () => {
    const episodes = [ep("s1e1", 1, 1), ep("s1e2", 1, 2, { releaseDate: "2099-01-01" })];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e1"),
      airingStatus: "Returning Series",
      todayISO: TODAY,
    });
    expect(p.status).toBe("up-to-date"); // future episode isn't "aired-unwatched"
    expect(p.airedCount).toBe(1);
    expect(p.nextUp).toBeNull();
  });
});

describe("computeShowProgress — next up", () => {
  it("is the lowest (season, episode) aired-unwatched episode across seasons", () => {
    // Unsorted input; S1E3 and S2E1 both aired-unwatched → S1E3 wins.
    const episodes = [ep("s2e1", 2, 1), ep("s1e3", 1, 3), ep("s1e1", 1, 1), ep("s1e2", 1, 2)];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e1", "s1e2"),
      airingStatus: "Returning Series",
      todayISO: TODAY,
    });
    expect(p.status).toBe("behind");
    expect(p.unwatchedAiredCount).toBe(2);
    expect(p.nextUp?.id).toBe("s1e3");
  });

  it("handles out-of-order watching (later watched, earlier not) — behind on the gap", () => {
    const episodes = [ep("s1e1", 1, 1), ep("s1e2", 1, 2)];
    const p = computeShowProgress({
      episodes,
      seenEvents: seen("s1e2"),
      airingStatus: "Returning Series",
      todayISO: TODAY,
    });
    expect(p.status).toBe("behind");
    expect(p.unwatchedAiredCount).toBe(1);
    expect(p.nextUp?.id).toBe("s1e1");
  });

  it("empty show → up-to-date, zero counts, no next up", () => {
    const p = computeShowProgress({ episodes: [], seenEvents: [], airingStatus: "Returning Series", todayISO: TODAY });
    expect(p).toMatchObject({
      status: "up-to-date",
      totalCounted: 0,
      airedCount: 0,
      unwatchedAiredCount: 0,
      nextUp: null,
    });
  });
});

describe("displayGroup", () => {
  const prog = (status: DerivedStatus, watchedAiredCount: number): ShowProgress => ({
    status,
    totalCounted: 10,
    airedCount: 10,
    watchedAiredCount,
    unwatchedAiredCount: 10 - watchedAiredCount,
    nextUp: null,
  });

  it("wanted + started defers to derived progress", () => {
    expect(displayGroup(true, prog("behind", 5))).toBe("behind");
    expect(displayGroup(true, prog("up-to-date", 10))).toBe("up-to-date");
  });
  it("wanted + nothing watched is planned", () => {
    expect(displayGroup(true, prog("behind", 0))).toBe("planned");
  });
  it("not wanted + started is stopped (mid-way or caught up)", () => {
    expect(displayGroup(false, prog("behind", 5))).toBe("stopped");
    expect(displayGroup(false, prog("up-to-date", 10))).toBe("stopped");
  });
  it("not wanted + nothing watched is off-list (the hidden default)", () => {
    expect(displayGroup(false, prog("behind", 0))).toBe("off-list");
  });
  it("finished (all aired watched + show ended) wins regardless of the flag", () => {
    expect(displayGroup(true, prog("finished", 10))).toBe("finished");
    expect(displayGroup(false, prog("finished", 10))).toBe("finished");
  });
  it("nothing watched is never 'finished' — an ended/cancelled show with 0 aired stays Planned/off-list", () => {
    expect(displayGroup(true, prog("finished", 0))).toBe("planned");
    expect(displayGroup(false, prog("finished", 0))).toBe("off-list");
  });
});
