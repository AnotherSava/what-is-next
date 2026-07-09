import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./throttle";

// Fake timers so the limiter's setTimeout-based re-pump and Date.now() window are deterministic.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RateLimiter", () => {
  it("never exceeds maxConcurrent in flight", async () => {
    const limiter = new RateLimiter({ maxRequests: 1000, windowMs: 10_000, maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.schedule(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => setTimeout(r, 100));
        active--;
      });
    const all = Promise.all([task(), task(), task(), task(), task()]);
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(peak).toBe(2);
  });

  it("limits starts per sliding window", async () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000, maxConcurrent: 100 });
    const startTimes: number[] = [];
    const base = Date.now();
    const task = () => limiter.schedule(async () => void startTimes.push(Date.now() - base));

    const all = Promise.all(Array.from({ length: 5 }, () => task()));
    await vi.advanceTimersByTimeAsync(0);
    expect(startTimes.length).toBe(3); // window full after 3 starts

    await vi.advanceTimersByTimeAsync(1001); // oldest starts age out → remaining 2 proceed
    await all;
    expect(startTimes.length).toBe(5);
    expect(startTimes.slice(3)).toEqual([1001, 1001]);
  });

  it("returns the task's value and propagates errors", async () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000, maxConcurrent: 5 });
    await expect(limiter.schedule(async () => 42)).resolves.toBe(42);
    await expect(limiter.schedule(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
