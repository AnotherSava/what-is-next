import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/lib/throttle";
import loginFixture from "./fixtures/login.json";
import movieExtended from "./fixtures/movie-extended.json";
import seriesExtended from "./fixtures/series-extended.json";
import { TvdbClient, TvdbError } from "./client";

// Permissive limiter + no-op sleep so tests exercise the auth/fetch/retry/parse/paginate logic without waits.
function makeClient(fetchImpl: typeof fetch, opts: { pin?: string; maxRetries?: number } = {}) {
  return new TvdbClient({
    apikey: "KEY",
    pin: opts.pin,
    fetchImpl,
    limiter: new RateLimiter({ maxRequests: 1000, windowMs: 1000, maxConcurrent: 100 }),
    sleep: () => Promise.resolve(),
    maxRetries: opts.maxRetries ?? 4,
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const isLogin = (url: string, init?: RequestInit) => init?.method === "POST" && url.endsWith("/login");

describe("TvdbClient", () => {
  it("logs in lazily and sends a Bearer token on the first GET", async () => {
    const loginBodies: string[] = [];
    let bearer: string | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isLogin(url, init)) {
        loginBodies.push(String(init?.body));
        return jsonResponse(loginFixture);
      }
      bearer = (init?.headers as Record<string, string>).Authorization;
      return jsonResponse(seriesExtended);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const series = await client.getSeriesExtended(420847);
    expect(series.name).toBe("Backrooms");
    expect(bearer).toBe("Bearer TEST_JWT_TOKEN");
    expect(JSON.parse(loginBodies[0])).toEqual({ apikey: "KEY" });
  });

  it("includes the subscriber PIN in the login body only when provided", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(loginFixture);
      }
      return jsonResponse(movieExtended);
    });
    await makeClient(fetchImpl as unknown as typeof fetch, { pin: "PIN123" }).getMovieExtended(138435);
    expect(bodies[0]).toEqual({ apikey: "KEY", pin: "PIN123" });
  });

  it("caches the token: two GETs trigger one login", async () => {
    let logins = 0;
    let gets = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) {
        logins++;
        return jsonResponse(loginFixture);
      }
      gets++;
      return jsonResponse(movieExtended);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.getMovieExtended(138435);
    await client.getMovieExtended(138435);
    expect(logins).toBe(1);
    expect(gets).toBe(2);
  });

  it("re-authenticates once on a 401, then succeeds", async () => {
    let logins = 0;
    let gets = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) {
        logins++;
        return jsonResponse(loginFixture);
      }
      gets++;
      return gets === 1 ? jsonResponse({ message: "unauthorized" }, 401) : jsonResponse(seriesExtended);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const series = await client.getSeriesExtended(420847);
    expect(series.id).toBe(420847);
    expect(logins).toBe(2);
    expect(gets).toBe(2);
  });

  it("gives up after a single re-auth on persistent 401", async () => {
    let logins = 0;
    let gets = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) {
        logins++;
        return jsonResponse(loginFixture);
      }
      gets++;
      return jsonResponse({ message: "unauthorized" }, 401);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getSeriesExtended(420847)).rejects.toMatchObject({ status: 401 });
    expect(logins).toBe(2);
    expect(gets).toBe(2);
  });

  it("paginates episodes, following links.next across pages", async () => {
    const ep = (id: number, number: number) => ({
      id,
      name: `E${number}`,
      seasonNumber: 1,
      number,
      aired: "2022-01-01",
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isLogin(url, init)) return jsonResponse(loginFixture);
      const page = new URL(url).searchParams.get("page");
      if (page === "0") {
        return jsonResponse({ status: "ok", data: { episodes: [ep(1, 1)] }, links: { next: "?page=1" } });
      }
      return jsonResponse({ status: "ok", data: { episodes: [ep(2, 2)] }, links: { next: null } });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const eps = await client.getAllSeriesEpisodes(420847);
    expect(eps.map((e) => e.number)).toEqual([1, 2]);
  });

  it("retries a 5xx then succeeds, and does not retry a terminal 404", async () => {
    let n = 0;
    const retryFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) return jsonResponse(loginFixture);
      n++;
      return n === 1 ? jsonResponse({ e: "server" }, 503) : jsonResponse(movieExtended);
    });
    const okAfterRetry = makeClient(retryFetch as unknown as typeof fetch, { maxRetries: 2 });
    expect((await okAfterRetry.getMovieExtended(138435)).id).toBe(138435);
    expect(n).toBe(2);

    let gets = 0;
    const notFoundFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLogin(String(input), init)) return jsonResponse(loginFixture);
      gets++;
      return jsonResponse({ message: "not found" }, 404);
    });
    const client = makeClient(notFoundFetch as unknown as typeof fetch);
    await expect(client.getMovieExtended(999999)).rejects.toBeInstanceOf(TvdbError);
    expect(gets).toBe(1);
  });

  it("rejects a schema-invalid response", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      isLogin(String(input), init) ? jsonResponse(loginFixture) : jsonResponse({ status: "ok", data: { id: "nope" } }),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getSeriesExtended(1)).rejects.toBeInstanceOf(Error);
  });
});
