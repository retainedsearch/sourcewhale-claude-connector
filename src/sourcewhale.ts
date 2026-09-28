/**
 * Talks to the SourceWhale public API.
 *
 * Built against the official spec saved in docs/sourcewhale-openapi.json
 * (from https://sourcewhale.app/public-api/swagger). Authentication is an
 * "api-key" request header.
 *
 * Every call returns either { ok: true, data } or { ok: false, message }.
 * Error messages are written here, in plain English, and never include
 * SourceWhale's own response body. That keeps candidate records out of error
 * text, and keeps the API key out of anything Claude or a log can see.
 */

const BASE_URL = "https://sourcewhale.app/public-api";
const TIMEOUT_MS = 30_000;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export async function callSourceWhale<T = unknown>(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  options: { params?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<ApiResult<T>> {
  if (!apiKey) {
    return { ok: false, message: "The SourceWhale API key has not been set up on this server." };
  }

  // Build the web address, leaving out any optional parameters that were not given.
  const url = new URL(BASE_URL + path);
  for (const [name, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? "SourceWhale did not respond within 30 seconds. Try again shortly."
        : "Could not reach SourceWhale. Check the internet connection and try again.",
    };
  }

  // Turn failures into short, safe messages. We deliberately do not retry:
  // one polite message is better than hammering the API.
  if (!response.ok) {
    return { ok: false, message: describeFailure(response) };
  }

  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, message: "SourceWhale sent back a response this server could not read." };
  }
}

function describeFailure(response: Response): string {
  const status = response.status;
  if (status === 401 || status === 403) {
    return `SourceWhale refused the API key (HTTP ${status}). It may be wrong, revoked, or API access may not be enabled on the account.`;
  }
  if (status === 404) {
    return "SourceWhale could not find that record (HTTP 404).";
  }
  if (status === 429) {
    const wait = response.headers.get("Retry-After");
    return `SourceWhale's rate limit was reached. Wait ${wait ? `${wait} seconds` : "a minute"} before trying again.`;
  }
  if (status >= 400 && status < 500) {
    return `SourceWhale rejected the request (HTTP ${status}). Check the values given, for example the search key or date format.`;
  }
  return `SourceWhale had a problem on its side (HTTP ${status}). Try again later.`;
}
