import { describe, expect, it, vi } from "vitest";
import tvDetail from "./fixtures/tv-detail.json";
import { RateLimiter } from "./throttle";
import { TmdbClient, TmdbError } from "./client";

// A permissive limiter + no-op sleep so tests exercise the fetch/retry/parse/dedupe logic without real waits.
// getTvDetail is the vehicle for the generic request machinery (retry/dedupe/parse) — an endpoint the app uses.
function makeClient(fetchImpl: typeof fetch, opts: { maxRetries?: number } = {}) {
  return new TmdbClient({
    token: "TEST_TOKEN",
    fetchImpl,
    limiter: new RateLimiter({ maxRequests: 1000, windowMs: 1000, maxConcurrent: 100 }),
    sleep: () => Promise.resolve(),
    maxRetries: opts.maxRetries ?? 4,
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("TmdbClient", () => {
  it("sends a Bearer token and builds the /find URL with external_source", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer TEST_TOKEN");
      return jsonResponse({ movie_results: [], tv_results: [] });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.findByTvdb(327417);
    expect(calls[0]).toBe("https://api.themoviedb.org/3/find/327417?external_source=tvdb_id");
  });

  it("appends external_ids on tv detail and parses it", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse(tvDetail);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const detail = await client.getTvDetail(71446);
    expect(calls[0]).toBe("https://api.themoviedb.org/3/tv/71446?append_to_response=external_ids");
    expect(detail.status).toBe("Ended");
    expect(detail.external_ids?.tvdb_id).toBe(327417);
  });

  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n === 1 ? jsonResponse({ status_message: "rate limited" }, 429) : jsonResponse(tvDetail);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const detail = await client.getTvDetail(71446);
    expect(n).toBe(2);
    expect(detail.name).toBe("Money Heist");
  });

  it("retries 5xx up to maxRetries then throws a TmdbError with the status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "server" }, 503));
    const client = makeClient(fetchImpl as unknown as typeof fetch, { maxRetries: 2 });
    await expect(client.getTvDetail(71446)).rejects.toBeInstanceOf(TmdbError);
    await expect(client.getTvDetail(71446)).rejects.toMatchObject({ status: 503 });
    // initial + 2 retries = 3 attempts, twice (two awaited calls) = 6
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("does NOT retry a terminal 404", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status_message: "not found" }, 404));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getMovieDetail(999999)).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent identical requests into a single fetch", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      await Promise.resolve();
      return jsonResponse(tvDetail);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const [a, b] = await Promise.all([client.getTvDetail(71446), client.getTvDetail(71446)]);
    expect(n).toBe(1);
    expect(a).toEqual(b);
    // once settled, a fresh call fetches again (in-flight map cleared)
    await client.getTvDetail(71446);
    expect(n).toBe(2);
  });

  it("rejects on a malformed (schema-invalid) response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "not-a-number" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getTvDetail(71446)).rejects.toBeInstanceOf(Error);
  });
});
