/**
 * Small fetch helper: browser-ish headers, timeouts, retry with backoff, and a
 * global concurrency limiter so a refresh never hammers a source.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** Milliseconds for the first retry; doubles each attempt. */
  backoffMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export async function httpFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 20_000,
    retries = 2,
    backoffMs = 800,
    headers,
    ...rest
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...rest,
        signal: controller.signal,
        headers: {
          "user-agent": DEFAULT_UA,
          accept: "application/json, text/plain, */*",
          "accept-language": "en-CA,en;q=0.9",
          ...(headers as Record<string, string> | undefined),
        },
      });
      // 4xx other than 429 will not fix themselves — fail fast.
      if (!response.ok && response.status !== 429 && response.status < 500) {
        const body = await safeText(response);
        throw new HttpError(response.status, url, body);
      }
      if (!response.ok) {
        throw new HttpError(response.status, url, await safeText(response));
      }
      return response;
    } catch (error) {
      lastError = error;
      const retryable =
        !(error instanceof HttpError) ||
        error.status === 429 ||
        error.status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const response = await httpFetch(url, options);
  return (await response.json()) as T;
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const response = await httpFetch(url, {
    ...options,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  return await response.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `worker` over `items` with bounded concurrency, preserving input order.
 * Rejections are surfaced to the caller as rejected values rather than
 * aborting the whole batch.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length || 1));

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return results;
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return undefined;
  }
}
