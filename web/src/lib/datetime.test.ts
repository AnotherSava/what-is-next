import { describe, expect, it } from "vitest";
import { displayDate, isoDate, isoDatePlusDays, parseWatchDate, todayISO } from "./datetime";

describe("displayDate", () => {
  it("formats a moment as a human 'Mon D, YYYY' date in the given timezone", () => {
    // 2026-06-02 06:30 UTC is still 2026-06-01 (23:30) in Vancouver (UTC-7 in summer).
    const t = new Date("2026-06-02T06:30:00Z");
    expect(displayDate(t, "UTC")).toBe("Jun 2, 2026");
    expect(displayDate(t, "America/Vancouver")).toBe("Jun 1, 2026");
  });
  it("falls back to a valid format for a bad timezone", () => {
    const t = new Date("2026-06-02T12:00:00Z");
    expect(displayDate(t, "Not/AZone")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });
});

describe("isoDate", () => {
  it("formats a moment's calendar date as YYYY-MM-DD in the given timezone", () => {
    // 2026-07-08 06:30 UTC is still 2026-07-07 (23:30) in Vancouver (UTC-7 in summer).
    const t = new Date("2026-07-08T06:30:00Z");
    expect(isoDate(t, "UTC")).toBe("2026-07-08");
    expect(isoDate(t, "America/Vancouver")).toBe("2026-07-07");
  });
  it("falls back to a valid format for a bad timezone", () => {
    const t = new Date("2026-07-08T12:00:00Z");
    expect(isoDate(t, "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("todayISO", () => {
  it("formats as YYYY-MM-DD in the given timezone", () => {
    // 2026-07-08 06:30 UTC is still 2026-07-07 (23:30) in Vancouver (UTC-7 in summer).
    const t = new Date("2026-07-08T06:30:00Z");
    expect(todayISO(t, "UTC")).toBe("2026-07-08");
    expect(todayISO(t, "America/Vancouver")).toBe("2026-07-07");
  });
  it("falls back to a valid format for a bad timezone", () => {
    const t = new Date("2026-07-08T12:00:00Z");
    expect(todayISO(t, "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseWatchDate", () => {
  // The regression this exists for: a date-only string parsed as UTC midnight lands on the previous local day in
  // any negative UTC offset, so the date you picked rendered a day early. Round-tripping is the real contract.
  it("round-trips a picked date through the display formatters", () => {
    for (const zone of ["America/Vancouver", "UTC", "Asia/Tokyo", "Asia/Kolkata"]) {
      for (const picked of ["2026-08-06", "2026-08-01", "2026-03-01", "2026-01-01", "2026-12-31"]) {
        const stored = parseWatchDate(picked, zone);
        expect(stored).not.toBeNull();
        expect(isoDate(stored as Date, zone), `${picked} in ${zone}`).toBe(picked);
      }
    }
  });

  it("round-trips across a DST transition in both directions", () => {
    // Vancouver springs forward 2026-03-08 and falls back 2026-11-01.
    for (const picked of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"]) {
      const stored = parseWatchDate(picked, "America/Vancouver") as Date;
      expect(isoDate(stored, "America/Vancouver"), picked).toBe(picked);
    }
  });

  it("anchors a date-only string at local noon, not UTC midnight", () => {
    // UTC-7: noon local is 19:00 UTC the same day — the old `new Date(iso)` gave 00:00 UTC, i.e. the day before.
    expect((parseWatchDate("2026-08-06", "America/Vancouver") as Date).toISOString()).toBe("2026-08-06T19:00:00.000Z");
  });

  it("passes through a string that already carries a time", () => {
    // Media-server imports are true instants — re-anchoring them to noon would destroy the recorded time of day.
    const iso = "2026-08-06T02:50:18.235Z";
    expect((parseWatchDate(iso, "America/Vancouver") as Date).toISOString()).toBe(iso);
  });

  it("returns null for absent or unparseable input", () => {
    expect(parseWatchDate(undefined)).toBeNull();
    expect(parseWatchDate("")).toBeNull();
    expect(parseWatchDate("not-a-date")).toBeNull();
  });

  it("falls back to a usable instant for a bad timezone", () => {
    expect(parseWatchDate("2026-08-06", "Not/AZone")).toBeInstanceOf(Date);
  });
});

describe("isoDatePlusDays", () => {
  it("advances by whole days in the timezone", () => {
    const from = new Date("2026-07-08T12:00:00Z");
    expect(isoDatePlusDays(14, from, "UTC")).toBe("2026-07-22");
    expect(isoDatePlusDays(0, from, "UTC")).toBe("2026-07-08");
  });
});
