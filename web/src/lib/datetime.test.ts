import { describe, expect, it } from "vitest";
import { isoDatePlusDays, todayISO } from "./datetime";

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
