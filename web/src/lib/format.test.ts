import { describe, expect, it } from "vitest";
import { formatInterval, plural, seconds } from "./format";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatInterval", () => {
  it("clamps sub-minute, zero, and negative intervals to 1m", () => {
    expect(formatInterval(-5000)).toBe("1m");
    expect(formatInterval(0)).toBe("1m");
    expect(formatInterval(30 * 1000)).toBe("1m");
  });

  it("floors to the largest unit", () => {
    expect(formatInterval(59 * MIN)).toBe("59m");
    expect(formatInterval(90 * MIN)).toBe("1h");
    expect(formatInterval(23 * HOUR)).toBe("23h");
    expect(formatInterval(5 * DAY)).toBe("5d");
    expect(formatInterval(29 * DAY)).toBe("29d");
  });

  it("switches to months at 30 days and years at 365 days", () => {
    expect(formatInterval(30 * DAY)).toBe("1mo");
    expect(formatInterval(89 * DAY)).toBe("2mo");
    expect(formatInterval(364 * DAY)).toBe("12mo");
    expect(formatInterval(365 * DAY)).toBe("1y");
    expect(formatInterval(1060 * DAY)).toBe("2y");
  });

  it("never reads 0mo or 0y at the unit boundaries", () => {
    expect(formatInterval(30 * DAY)).not.toContain("0mo");
    expect(formatInterval(365 * DAY)).not.toContain("0y");
  });
});

describe("plural", () => {
  it("pluralizes regular and irregular nouns", () => {
    expect(plural(1, "show")).toBe("1 show");
    expect(plural(2, "show")).toBe("2 shows");
    expect(plural(2, "watch", "watches")).toBe("2 watches");
  });
});

describe("seconds", () => {
  it("renders whole-tenths of a second", () => {
    expect(seconds(3200)).toBe("3.2s");
  });
});
