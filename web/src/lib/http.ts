// Shared HTTP machinery for the external-API clients (TMDB, TVDB). Kept in one place so a fix to the
// retry/backoff/Retry-After logic can't land in one client and silently miss the other (single source of logic).
// Auth, response de-dupe and zod parsing stay in each client — only the transport primitives live here.

export type QueryParams = Record<string, string | number | undefined>;

export function buildUrl(baseUrl: string, path: string, params: QueryParams): string {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

function backoffMs(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt;
}

export interface FetchRetryOptions {
  fetchImpl: typeof fetch;
  maxRetries: number;
  backoffBaseMs: number;
  sleep: (ms: number) => Promise<void>;
  label: string; // provider tag for error messages ("TMDB" | "TVDB")
  makeError: (message: string, status?: number) => Error;
}

// Fetch with retry+backoff: 429 (rate limited) and 5xx are transient and retried (honouring Retry-After) up to
// maxRetries; other 4xx (401, 404, …) are terminal and surfaced via makeError. Returns the parsed JSON body.
export async function fetchJsonWithRetry(url: string, init: RequestInit, opts: FetchRetryOptions): Promise<unknown> {
  const { fetchImpl, maxRetries, backoffBaseMs, sleep, label, makeError } = opts;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (attempt >= maxRetries) throw makeError(`Network error: ${String(err)}`);
      await sleep(backoffMs(backoffBaseMs, attempt));
      continue;
    }

    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxRetries) throw makeError(`${label} ${res.status} after ${attempt} retries`, res.status);
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(backoffBaseMs, attempt);
      await sleep(waitMs);
      continue;
    }

    throw makeError(`${label} ${res.status}`, res.status);
  }
}
