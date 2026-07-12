import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/lib/throttle";
import { OmdbClient, OmdbError } from "./client";

// A permissive limiter + no-op sleep so tests exercise the fetch/retry/parse/dedupe logic without real waits.
function makeClient(fetchImpl: typeof fetch, opts: { maxRetries?: number } = {}) {
  return new OmdbClient({
    apikey: "TESTKEY",
    fetchImpl,
    limiter: new RateLimiter({ maxRequests: 1000, windowMs: 1000, maxConcurrent: 100 }),
    sleep: () => Promise.resolve(),
    maxRetries: opts.maxRetries ?? 4,
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("OmdbClient", () => {
  it("builds the /?i=…&apikey=… URL and parses the imdb rating", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ Response: "True", Title: "Inception", imdbID: "tt1375666", imdbRating: "8.8" });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const rating = await client.getImdbRating("tt1375666");
    expect(calls[0]).toBe("https://www.omdbapi.com/?i=tt1375666&apikey=TESTKEY");
    expect(rating).toBe(8.8);
  });

  it("returns null when the title is unrated (imdbRating 'N/A')", async () => {
    const client = makeClient((async () =>
      jsonResponse({ Response: "True", Title: "Obscure", imdbRating: "N/A" })) as unknown as typeof fetch);
    expect(await client.getImdbRating("tt0000001")).toBeNull();
  });

  it("returns null for an unknown id (Response 'False', not-found error)", async () => {
    const client = makeClient((async () =>
      jsonResponse({ Response: "False", Error: "Incorrect IMDb ID." })) as unknown as typeof fetch);
    expect(await client.getImdbRating("tt9999999")).toBeNull();
  });

  it("throws (does not swallow) on a config/quota error so a broken key can't silently backfill nulls", async () => {
    const client = makeClient((async () =>
      jsonResponse({ Response: "False", Error: "Request limit reached!" })) as unknown as typeof fetch);
    await expect(client.getImdbRating("tt1375666")).rejects.toThrow(OmdbError);
  });

  it("surfaces a 401 (invalid key) as a terminal OmdbError", async () => {
    const client = makeClient((async () =>
      jsonResponse({ Response: "False", Error: "Invalid API key!" }, 401)) as unknown as typeof fetch);
    await expect(client.getImdbRating("tt1375666")).rejects.toMatchObject({ status: 401 });
  });

  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return n === 1
        ? jsonResponse({ Response: "False", Error: "rate limited" }, 429)
        : jsonResponse({ Response: "True", imdbRating: "7.1" });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.getImdbRating("tt1375666")).toBe(7.1);
    expect(n).toBe(2);
  });

  it("de-dupes concurrent identical lookups into one fetch", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      return jsonResponse({ Response: "True", imdbRating: "6.5" });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const [a, b] = await Promise.all([client.getImdbRating("tt1"), client.getImdbRating("tt1")]);
    expect(a).toBe(6.5);
    expect(b).toBe(6.5);
    expect(n).toBe(1);
  });
});
