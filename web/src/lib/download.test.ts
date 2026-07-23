import { describe, expect, it } from "vitest";
import { classifyDownloads, missingFromPlex, unwatchedInPlexCount, type DownloadShow } from "./download";

// The episode row shape missingFromPlex consumes (ProgressEpisode + title).
function ep(id: string, season: number, episode: number, releaseDate: string | null, isSpecial = false) {
  return { id, seasonNumber: season, episodeNumber: episode, isSpecial, releaseDate, title: `S${season}E${episode}` };
}

describe("missingFromPlex", () => {
  const today = "2026-07-11";

  it("returns aired, unwatched episodes that aren't in Plex", () => {
    const eps = [
      ep("watched", 1, 1, "2026-01-01"),
      ep("inPlex", 1, 2, "2026-02-01"),
      ep("missing", 1, 3, "2026-03-01"),
      ep("future", 1, 4, "2027-01-01"),
    ];
    const missing = missingFromPlex(eps, new Set(["watched"]), new Set(["inPlex"]), today);
    expect(missing.map((m) => m.id)).toEqual(["missing"]);
  });

  it("excludes specials, mirroring the counted-episode rule", () => {
    const eps = [ep("special", 0, 1, "2026-01-01", true), ep("regular", 1, 1, "2026-01-01")];
    expect(missingFromPlex(eps, new Set(), new Set(), today).map((m) => m.id)).toEqual(["regular"]);
  });

  it("treats a null or future release date as not aired", () => {
    const eps = [ep("undated", 1, 1, null), ep("future", 1, 2, "2999-01-01")];
    expect(missingFromPlex(eps, new Set(), new Set(), today)).toEqual([]);
  });

  it("orders results by season then episode (earliest to download first)", () => {
    const eps = [ep("b", 2, 1, "2026-01-01"), ep("a", 1, 2, "2026-01-01"), ep("c", 1, 1, "2026-01-01")];
    expect(missingFromPlex(eps, new Set(), new Set(), today).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("finds a missing later episode even when earlier ones of the same season are in Plex", () => {
    // The within-season gap season-level presence can't see: E1–E2 owned, E3 aired but not downloaded.
    const eps = [ep("e1", 1, 1, "2026-01-01"), ep("e2", 1, 2, "2026-02-01"), ep("e3", 1, 3, "2026-03-01")];
    const missing = missingFromPlex(eps, new Set(), new Set(["e1", "e2"]), today);
    expect(missing.map((m) => m.id)).toEqual(["e3"]);
  });

  it("restricts to complete seasons when given a completeSeasons set (wait for the full season)", () => {
    // Season 1 complete, season 2 still airing → only season 1's missing episode is offered.
    const eps = [ep("s1e1", 1, 1, "2026-01-01"), ep("s2e1", 2, 1, "2026-06-01")];
    expect(missingFromPlex(eps, new Set(), new Set(), today, new Set([1])).map((m) => m.id)).toEqual(["s1e1"]);
    // An empty complete-season set (no season fully aired yet) means nothing is downloadable.
    expect(missingFromPlex(eps, new Set(), new Set(), today, new Set())).toEqual([]);
  });
});

describe("unwatchedInPlexCount", () => {
  const today = "2026-07-11";

  it("counts aired, unwatched episodes that ARE in Plex (the 'still to watch' count)", () => {
    const eps = [
      ep("watched", 1, 1, "2026-01-01"), // in Plex but watched — doesn't count
      ep("toWatch1", 1, 2, "2026-02-01"), // in Plex, unwatched — counts
      ep("toWatch2", 1, 3, "2026-03-01"), // in Plex, unwatched — counts
      ep("missing", 1, 4, "2026-04-01"), // not in Plex — doesn't count
      ep("future", 1, 5, "2027-01-01"), // in Plex but not aired — doesn't count
    ];
    const present = new Set(["watched", "toWatch1", "toWatch2", "future"]);
    expect(unwatchedInPlexCount(eps, new Set(["watched"]), present, today)).toBe(2);
  });

  it("is 0 when every in-Plex episode is watched (the 'Get back' case)", () => {
    const eps = [ep("a", 1, 1, "2026-01-01"), ep("b", 1, 2, "2026-02-01")];
    // Both aired episodes are in Plex and both watched; a later one (c) aired but isn't downloaded.
    const eps2 = [...eps, ep("c", 1, 3, "2026-03-01")];
    expect(unwatchedInPlexCount(eps2, new Set(["a", "b"]), new Set(["a", "b"]), today)).toBe(0);
  });

  it("excludes specials and not-yet-aired episodes", () => {
    const eps = [ep("special", 0, 1, "2026-01-01", true), ep("future", 1, 1, "2999-01-01")];
    expect(unwatchedInPlexCount(eps, new Set(), new Set(["special", "future"]), today)).toBe(0);
  });

  it("counts only complete seasons when given a completeSeasons set", () => {
    // Both in Plex + unwatched, but season 2 is still airing → only season 1's episode counts as watchable now.
    const eps = [ep("s1e1", 1, 1, "2026-01-01"), ep("s2e1", 2, 1, "2026-06-01")];
    expect(unwatchedInPlexCount(eps, new Set(), new Set(["s1e1", "s2e1"]), today, new Set([1]))).toBe(1);
  });
});

describe("classifyDownloads", () => {
  const row = (title: string, lastWatchedAt: string | null, missingCount = 1): DownloadShow => ({
    showId: `id-${title}`,
    slug: `id-${title}`,
    title,
    posterPath: null,
    isFavorite: false,
    tmdbRating: null,
    imdbRating: null,
    imdbId: null,
    missingCount,
    lastWatchedAt: lastWatchedAt ? new Date(lastWatchedAt) : null,
    missingSeasons: [],
  });
  const analyzed = (title: string, lastWatchedAt: string | null, inPlexLeft: number) => ({
    row: row(title, lastWatchedAt),
    inPlexLeft,
  });

  it("puts 0-unwatched-in-Plex shows in Get back and >0 in More of", () => {
    const { getBack, moreOf } = classifyDownloads(
      [analyzed("blocked", "2026-01-01", 0), analyzed("stocked", "2026-01-01", 4)],
      [],
    );
    expect(getBack.map((s) => s.title)).toEqual(["blocked"]);
    expect(moreOf.map((s) => s.title)).toEqual(["stocked"]);
  });

  it("orders Get back / More of by last-watched date descending, undated last, title tie-break", () => {
    const started = [
      analyzed("older", "2025-01-01", 0),
      analyzed("newest", "2026-06-01", 0),
      analyzed("undated", null, 0),
      analyzed("mid", "2025-06-01", 0),
    ];
    expect(classifyDownloads(started, []).getBack.map((s) => s.title)).toEqual(["newest", "mid", "older", "undated"]);
  });

  it("breaks equal last-watched dates by title", () => {
    const started = [analyzed("Zed", "2026-01-01", 2), analyzed("Ana", "2026-01-01", 2)];
    expect(classifyDownloads(started, []).moreOf.map((s) => s.title)).toEqual(["Ana", "Zed"]);
  });

  it("orders Not started by descending missing count, title tie-break", () => {
    const notStarted = [row("X", null, 2), row("Y", null, 9), row("Z", null, 9)];
    expect(classifyDownloads([], notStarted).notStarted.map((s) => s.title)).toEqual(["Y", "Z", "X"]);
  });
});
