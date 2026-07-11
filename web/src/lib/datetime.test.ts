import { describe, expect, it } from "vitest";
import { displayDate, isoDate, isoDatePlusDays, todayISO } from "./datetime";

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

describe("isoDatePlusDays", () => {
  it("advances by whole days in the timezone", () => {
    const from = new Date("2026-07-08T12:00:00Z");
    expect(isoDatePlusDays(14, from, "UTC")).toBe("2026-07-22");
    expect(isoDatePlusDays(0, from, "UTC")).toBe("2026-07-08");
  });
});
