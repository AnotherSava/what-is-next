import type { z } from "zod";
import { PROVIDER_LABEL, type MediaProvider } from "./types";

// Shared read-only transport for the media-server clients. Plex and Jellyfin differ only in their base URL and
// auth header, so the request/timeout/validate path lives here once rather than being copied into each client
// (single source of logic). NEITHER client ever writes to its server.

export class MediaServerError extends Error {
  constructor(
    message: string,
    readonly provider: MediaProvider,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MediaServerError";
  }
}

export interface JsonClientOptions {
  provider: MediaProvider;
  baseUrl: string;
  headers: Record<string, string>; // the provider's auth header
  fetchImpl?: typeof fetch; // injectable for tests
  timeoutMs?: number;
}

export class JsonClient {
  private readonly provider: MediaProvider;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: JsonClientOptions) {
    this.provider = opts.provider;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.headers = opts.headers;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const label = PROVIDER_LABEL[this.provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json", ...this.headers },
        signal: controller.signal,
      });
    } catch (err) {
      throw new MediaServerError(`${label} request failed: ${String(err)}`, this.provider);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new MediaServerError(`${label} ${res.status} on ${path}`, this.provider, res.status);
    return schema.parse(await res.json());
  }
}
