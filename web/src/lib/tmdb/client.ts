import type { z } from "zod";
import {
  tmdbFindSchema,
  tmdbMovieDetailSchema,
  tmdbMovieSearchSchema,
  tmdbSeasonDetailSchema,
  tmdbTvDetailSchema,
  tmdbTvSearchSchema,
  type TmdbFind,
  type TmdbMovieDetail,
  type TmdbSeasonDetail,
  type TmdbTvDetail,
} from "./schemas";
import { RateLimiter } from "./throttle";

// The ONE place that talks to TMDB (brief §3.2): every response zod-parsed, a global throttle, retry+backoff
// on 429/5xx, and in-process de-dupe of concurrent identical GETs. Nothing else in the app imports `fetch`
// for TMDB. Kept DB-free (image URL building lives in ./images.ts) so it's pure and unit-testable — fetch,
// limiter, clock and sleep are all injectable.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export interface TmdbClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type QueryParams = Record<string, string | number | undefined>;

export class TmdbClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: TmdbClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? TMDB_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // TMDB tolerates far more, but the brief targets a conservative ~40 req / 10 s with bounded concurrency.
    this.limiter = opts.limiter ?? new RateLimiter({ maxRequests: 40, windowMs: 10_000, maxConcurrent: 8 });
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── endpoints ──────────────────────────────────────────────────────────
  findByTvdb(tvdbId: number): Promise<TmdbFind> {
    return this.request(`/find/${encodeURIComponent(String(tvdbId))}`, { external_source: "tvdb_id" }, tmdbFindSchema);
  }
  findByImdb(imdbId: string): Promise<TmdbFind> {
    return this.request(`/find/${encodeURIComponent(imdbId)}`, { external_source: "imdb_id" }, tmdbFindSchema);
  }
  getTvDetail(id: number): Promise<TmdbTvDetail> {
    return this.request(`/tv/${id}`, { append_to_response: "external_ids" }, tmdbTvDetailSchema);
  }
  getSeasonDetail(id: number, seasonNumber: number): Promise<TmdbSeasonDetail> {
    return this.request(`/tv/${id}/season/${seasonNumber}`, {}, tmdbSeasonDetailSchema);
  }
  getMovieDetail(id: number): Promise<TmdbMovieDetail> {
    return this.request(`/movie/${id}`, { append_to_response: "external_ids" }, tmdbMovieDetailSchema);
  }
  searchTv(query: string, page = 1) {
    return this.request(`/search/tv`, { query, page, include_adult: "false" }, tmdbTvSearchSchema);
  }
  searchMovie(query: string, page = 1) {
    return this.request(`/search/movie`, { query, page, include_adult: "false" }, tmdbMovieSearchSchema);
  }

  // ── core ───────────────────────────────────────────────────────────────
  private request<T>(path: string, params: QueryParams, schema: z.ZodType<T>): Promise<T> {
    const url = this.buildUrl(path, params);
    const existing = this.inflight.get(url);
    if (existing) return existing as Promise<T>;

    const promise = this.limiter
      .schedule(() => this.fetchWithRetry(url, path))
      .then((json) => schema.parse(json))
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, promise);
    return promise;
  }

  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    return url.toString();
  }

  private async fetchWithRetry(url: string, path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw new TmdbError(`Network error: ${String(err)}`, undefined, path);
        await this.sleep(this.backoffMs(attempt));
        continue;
      }

      if (res.ok) return res.json();

      // 429 (rate limited) and 5xx are transient → retry with backoff (honouring Retry-After when present).
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new TmdbError(`TMDB ${res.status} after ${attempt} retries`, res.status, path);
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs(attempt);
        await this.sleep(waitMs);
        continue;
      }

      // Other 4xx (e.g. 404 not found) are terminal — surfaced so callers can log unresolved items.
      throw new TmdbError(`TMDB ${res.status}`, res.status, path);
    }
  }

  private backoffMs(attempt: number): number {
    return this.backoffBaseMs * 2 ** attempt;
  }
}

// Lazy app singleton — reads the Bearer token from env. Import this everywhere except tests (which construct
// TmdbClient directly with injected fetch/limiter).
let singleton: TmdbClient | undefined;
export function getTmdb(): TmdbClient {
  if (!singleton) {
    const token = process.env.TMDB_API_TOKEN;
    if (!token) throw new Error("TMDB_API_TOKEN is not set");
    singleton = new TmdbClient({ token });
  }
  return singleton;
}
