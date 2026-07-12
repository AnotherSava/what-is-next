import type { z } from "zod";
import { buildUrl, fetchJsonWithRetry, type QueryParams } from "@/lib/http";
import { RateLimiter } from "@/lib/throttle";
import { omdbTitleSchema, type OmdbTitle } from "./schemas";

// The ONE place that talks to OMDb — the source of IMDb community ratings (TMDB's API doesn't expose them). Same
// contract as the TMDB/TVDB clients (zod-parsed responses, a shared throttle, retry+backoff on 429/5xx, and
// in-process de-dupe of concurrent identical GETs), except OMDb authenticates with an `apikey` query param rather
// than a header. DB-free and unit-testable — fetch, limiter, clock and sleep are all injectable.

const OMDB_BASE_URL = "https://www.omdbapi.com";

export class OmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "OmdbError";
  }
}

export interface OmdbClientOptions {
  apikey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class OmdbClient {
  private readonly apikey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: OmdbClientOptions) {
    this.apikey = opts.apikey;
    this.baseUrl = opts.baseUrl ?? OMDB_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // OMDb's free tier is a daily cap (~1k/day) with no strict per-second limit — keep concurrency modest and polite.
    this.limiter = opts.limiter ?? new RateLimiter({ maxRequests: 20, windowMs: 10_000, maxConcurrent: 4 });
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── endpoints ──────────────────────────────────────────────────────────
  // The IMDb rating (0–10) for a title by its imdb id, or null when OMDb has no numeric rating ("N/A") or simply
  // doesn't know the id (Response "False" with a not-found error). Throws OmdbError on transport/HTTP failures and
  // on a config/quota problem (bad key, daily limit reached) — a silent all-null backfill from a broken key would
  // be worse than a loud failure.
  async getImdbRating(imdbId: string): Promise<number | null> {
    const res = await this.getTitleById(imdbId);
    if (res.Response !== "True") {
      const err = res.Error ?? "unknown error";
      if (/api key|request limit/i.test(err)) throw new OmdbError(`OMDb: ${err}`, undefined, "/");
      return null; // genuinely unknown id / not found — a soft null, not an error
    }
    const raw = res.imdbRating;
    if (!raw || raw === "N/A") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  getTitleById(imdbId: string): Promise<OmdbTitle> {
    return this.request({ i: imdbId }, omdbTitleSchema);
  }

  // ── core ───────────────────────────────────────────────────────────────
  private request<T>(params: QueryParams, schema: z.ZodType<T>): Promise<T> {
    const url = buildUrl(this.baseUrl, "/", { ...params, apikey: this.apikey });
    const existing = this.inflight.get(url);
    if (existing) return existing as Promise<T>;

    const init: RequestInit = { headers: { Accept: "application/json" } };
    const promise = this.limiter
      .schedule(() =>
        fetchJsonWithRetry(url, init, {
          fetchImpl: this.fetchImpl,
          maxRetries: this.maxRetries,
          backoffBaseMs: this.backoffBaseMs,
          sleep: this.sleep,
          label: "OMDb",
          makeError: (message, status) => new OmdbError(message, status, "/"),
        }),
      )
      .then((json) => schema.parse(json))
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, promise);
    return promise;
  }
}

// Lazy app singleton — reads the API key from env. Import this everywhere except tests (which construct OmdbClient
// directly with injected fetch/limiter).
let singleton: OmdbClient | undefined;
export function getOmdb(): OmdbClient {
  const apikey = process.env.OMDB_API_KEY;
  if (!apikey) throw new Error("OMDB_API_KEY is not set");
  if (!singleton) singleton = new OmdbClient({ apikey });
  return singleton;
}

// Whether OMDb ratings are configured. Hydration and the backfill skip OMDb work gracefully when unset.
export function isOmdbConfigured(): boolean {
  return !!process.env.OMDB_API_KEY;
}
