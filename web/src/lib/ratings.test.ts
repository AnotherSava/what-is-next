import { describe, expect, it } from "vitest";
import { ratingsLine } from "./ratings";

describe("ratingsLine", () => {
  it("shows both, dot-separated, when they differ to one decimal", () => {
    expect(ratingsLine(8.2, 8.8)).toBe("TMDB 8.2 · IMDB 8.8");
  });

  it("collapses to a single IMDB label when they agree to one decimal", () => {
    expect(ratingsLine(8.44, 8.36)).toBe("IMDB 8.4"); // both round to 8.4
  });

  it("shows just the source that's present when only one exists", () => {
    expect(ratingsLine(7.4, null)).toBe("TMDB 7.4");
    expect(ratingsLine(null, 6.1)).toBe("IMDB 6.1");
  });

  it("omits (null) when neither is present", () => {
    expect(ratingsLine(null, null)).toBeNull();
  });

  it("treats a 0 (TMDB's no-votes sentinel) as unrated, not a real score", () => {
    expect(ratingsLine(0, null)).toBeNull();
    expect(ratingsLine(0, 7.2)).toBe("IMDB 7.2"); // the zero TMDB drops out, IMDB stands alone
  });
});
