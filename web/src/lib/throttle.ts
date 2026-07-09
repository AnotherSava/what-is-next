// Generic request throttle shared by the external-API clients (TMDB, TVDB). Stay under a request budget per
// sliding window, with bounded concurrency so a bulk hydrate (hundreds of season/episode fetches) can't
// stampede. This is a sliding window over request STARTS: a request may begin only when fewer than
// `maxConcurrent` are in flight AND fewer than `maxRequests` have started within the last `windowMs`. Clock +
// sleep are injectable so tests are deterministic.

export interface RateLimiterOptions {
  maxRequests: number; // starts allowed per window
  windowMs: number;
  maxConcurrent: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private running = 0;
  private starts: number[] = []; // timestamps of recent starts, pruned to the window
  private waiters: Array<() => void> = [];
  private repumpScheduled = false;

  constructor(opts: RateLimiterOptions) {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
    this.maxConcurrent = opts.maxConcurrent;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.pump();
    });
  }

  private release(): void {
    this.running--;
    this.pump();
  }

  private pump(): void {
    const now = this.now();
    this.starts = this.starts.filter((t) => now - t < this.windowMs);
    while (this.waiters.length > 0 && this.running < this.maxConcurrent && this.starts.length < this.maxRequests) {
      const resolve = this.waiters.shift()!;
      this.starts.push(this.now());
      this.running++;
      resolve();
    }
    // Still waiters, concurrency available, but the rate window is full → re-pump once the oldest start ages out.
    const blockedByWindow =
      this.waiters.length > 0 && this.running < this.maxConcurrent && this.starts.length >= this.maxRequests;
    if (blockedByWindow && !this.repumpScheduled) {
      this.repumpScheduled = true;
      const wait = Math.max(0, this.windowMs - (now - this.starts[0]!)) + 1;
      void this.sleep(wait).then(() => {
        this.repumpScheduled = false;
        this.pump();
      });
    }
  }
}
