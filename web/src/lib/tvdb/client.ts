import type { z } from "zod";
import { buildUrl, fetchJsonWithRetry, type QueryParams } from "@/lib/http";
import { RateLimiter } from "@/lib/throttle";
import {
  tvdbLoginResponseSchema,
  tvdbMovieExtendedResponseSchema,
  tvdbSeriesEpisodesResponseSchema,
  tvdbSeriesExtendedResponseSchema,
  type TvdbEpisode,
  type TvdbLinks,
  type TvdbMovieExtended,
  type TvdbSeriesExtended,
} from "./schemas";

// The ONE place that talks to TVDB — the fallback metadata source for titles TMDB can't resolve. Same contract
// as the TMDB client (zod-parsed responses, global throttle, retry+backoff, in-process de-dupe of concurrent
// identical GETs), plus TVDB's bearer-token auth: a lazy POST /login exchanges the API key (+ optional
// subscriber PIN) for a token valid ~1 month, cached in memory and re-fetched once on a 401. DB-free and
// unit-testable — fetch, limiter, clock and sleep are all injectable.

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";

export class TvdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "TvdbError";
  }
}

export interface TvdbClientOptions {
  apikey: string;
  pin?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class TvdbClient {
  private readonly apikey: string;
  private readonly pin?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private token: string | null = null;
  private loginInflight: Promise<string> | null = null;

  constructor(opts: TvdbClientOptions) {
    this.apikey = opts.apikey;
    this.pin = opts.pin;
    this.baseUrl = opts.baseUrl ?? TVDB_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.limiter = opts.limiter ?? new RateLimiter({ maxRequests: 40, windowMs: 10_000, maxConcurrent: 8 });
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── endpoints ──────────────────────────────────────────────────────────
  async getSeriesExtended(id: number): Promise<TvdbSeriesExtended> {
    const { data } = await this.get(`/series/${id}/extended`, {}, tvdbSeriesExtendedResponseSchema);
    return data;
  }
  async getMovieExtended(id: number): Promise<TvdbMovieExtended> {
    // meta=translations pulls the translations object; a movie's overview lives there, not at the top level.
    const { data } = await this.get(
      `/movies/${id}/extended`,
      { meta: "translations" },
      tvdbMovieExtendedResponseSchema,
    );
    return data;
  }

  // Every episode of a series in aired ("default") order, following pagination. `seasonType` mirrors TVDB's
  // ordering options; "default" matches TV Time's aired order (the import source).
  async getAllSeriesEpisodes(id: number, seasonType = "default"): Promise<TvdbEpisode[]> {
    const all: TvdbEpisode[] = [];
    for (let page = 0; page < 100; page++) {
      const { data, links } = await this.get(
        `/series/${id}/episodes/${seasonType}`,
        { page },
        tvdbSeriesEpisodesResponseSchema,
      );
      all.push(...data.episodes);
      if (data.episodes.length === 0 || !hasNextPage(links)) break;
    }
    return all;
  }

  // ── auth ─────────────────────────────────────────────────────────────────
  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    // Collapse concurrent first-requests onto a single login.
    if (!this.loginInflight) this.loginInflight = this.login().finally(() => (this.loginInflight = null));
    this.token = await this.loginInflight;
    return this.token;
  }

  private async login(): Promise<string> {
    const body: { apikey: string; pin?: string } = { apikey: this.apikey };
    if (this.pin) body.pin = this.pin;
    const json = await this.limiter.schedule(() =>
      this.fetchJson(buildUrl(this.baseUrl, "/login", {}), "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return tvdbLoginResponseSchema.parse(json).data.token;
  }

  // ── core ───────────────────────────────────────────────────────────────
  private get<T>(path: string, params: QueryParams, schema: z.ZodType<T>): Promise<T> {
    const url = buildUrl(this.baseUrl, path, params);
    const existing = this.inflight.get(url);
    if (existing) return existing as Promise<T>;

    const promise = this.getWithAuthRetry(url, path)
      .then((json) => schema.parse(json))
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, promise);
    return promise;
  }

  // Run an authed GET; on a 401 (expired/invalid token) drop the token, re-login once, and retry.
  private async getWithAuthRetry(url: string, path: string): Promise<unknown> {
    for (let authAttempt = 0; ; authAttempt++) {
      const token = await this.ensureToken();
      try {
        return await this.limiter.schedule(() =>
          this.fetchJson(url, path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }),
        );
      } catch (err) {
        if (err instanceof TvdbError && err.status === 401 && authAttempt === 0) {
          this.token = null;
          continue;
        }
        throw err;
      }
    }
  }

  private fetchJson(url: string, path: string, init: RequestInit): Promise<unknown> {
    return fetchJsonWithRetry(url, init, {
      fetchImpl: this.fetchImpl,
      maxRetries: this.maxRetries,
      backoffBaseMs: this.backoffBaseMs,
      sleep: this.sleep,
      label: "TVDB",
      makeError: (message, status) => new TvdbError(message, status, path),
    });
  }
}

function hasNextPage(links: TvdbLinks | null | undefined): boolean {
  return links != null && links.next != null && links.next !== "";
}

// Lazy app singleton — reads the API key (+ optional subscriber PIN) from env. Import this everywhere except
// tests (which construct TvdbClient directly with injected fetch/limiter).
let singleton: TvdbClient | undefined;
export function getTvdb(): TvdbClient {
  const apikey = process.env.TVDB_API_KEY;
  if (!apikey) throw new Error("TVDB_API_KEY is not set");
  if (!singleton) singleton = new TvdbClient({ apikey, pin: process.env.TVDB_PIN || undefined });
  return singleton;
}

// Whether the TVDB fallback is configured. Refresh/admin use this to skip TVDB work gracefully when unset.
export function isTvdbConfigured(): boolean {
  return !!process.env.TVDB_API_KEY;
}
