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
import { buildUrl, fetchJsonWithRetry, type QueryParams } from "@/lib/http";
import { RateLimiter } from "./throttle";

// The ONE place that talks to TMDB (brief §3.2): every response zod-parsed, a global throttle, retry+backoff
// on 429/5xx, and in-process de-dupe of concurrent identical GETs. Nothing else in the app imports `fetch`
// for TMDB. Kept DB-free (image URL building lives in ./images.ts) so it's pure and unit-testable — fetch,
// limiter, clock and sleep are all injectable. Transport primitives (buildUrl/retry) are shared via @/lib/http.

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
    return this.request(`/movie/${id}`, { append_to_response: "external_ids,credits" }, tmdbMovieDetailSchema);
  }
  searchTv(query: string, page = 1) {
    return this.request(`/search/tv`, { query, page, include_adult: "false" }, tmdbTvSearchSchema);
  }
  searchMovie(query: string, page = 1) {
    return this.request(`/search/movie`, { query, page, include_adult: "false" }, tmdbMovieSearchSchema);
  }

  // ── core ───────────────────────────────────────────────────────────────
  private request<T>(path: string, params: QueryParams, schema: z.ZodType<T>): Promise<T> {
    const url = buildUrl(this.baseUrl, path, params);
    const existing = this.inflight.get(url);
    if (existing) return existing as Promise<T>;

    const init: RequestInit = { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } };
    const promise = this.limiter
      .schedule(() =>
        fetchJsonWithRetry(url, init, {
          fetchImpl: this.fetchImpl,
          maxRetries: this.maxRetries,
          backoffBaseMs: this.backoffBaseMs,
          sleep: this.sleep,
          label: "TMDB",
          makeError: (message, status) => new TmdbError(message, status, path),
        }),
      )
      .then((json) => schema.parse(json))
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, promise);
    return promise;
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
