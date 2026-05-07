import { ExitCodeName } from "./contracts/exit-codes.js";
import { CliError } from "./errors.js";
import { redact } from "./redact.js";
import { recordTrace } from "./runtime/trace.js";

export interface HttpTextResponse {
  url: string;
  method: string;
  ok: boolean;
  status: number;
  headers: Headers;
  contentType: string;
  text: string;
}

export interface FetchTextOptions {
  fetcher?: typeof fetch;
  name?: string;
  service?: string;
  bodyPreview?: "errors" | "always" | "never";
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  options: FetchTextOptions = {}
): Promise<HttpTextResponse> {
  const fetcher = options.fetcher ?? fetch;
  const method = init.method || "GET";
  const name = options.name || `${method} ${new URL(url).host}`;
  const startedAt = performance.now();

  try {
    const response = await fetcher(url, init);
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    recordTrace({
      name,
      duration_ms: Math.round(performance.now() - startedAt),
      request_url: url,
      request_method: method,
      response_status: response.status,
      response_content_type: contentType || undefined,
      response_headers: traceHeaders(response.headers),
      response_body_preview: shouldPreviewBody(response, text, options.bodyPreview ?? "errors")
        ? previewBody(text)
        : undefined
    });

    return {
      url,
      method,
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      contentType,
      text
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordTrace({
      name,
      duration_ms: Math.round(performance.now() - startedAt),
      request_url: url,
      request_method: method,
      error: message
    });
    throw networkError(url, message);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: FetchTextOptions = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetchText(url, { ...init, headers }, options);
  const parsed = parseJsonBody<T>(response, options.service);
  if (!response.ok) throw httpError(response, parsed);
  return parsed;
}

export function parseJsonBody<T>(response: HttpTextResponse, service = "Nitrosend API"): T {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    if (!response.ok) throw httpError(response);
    throw new CliError(`Unexpected response from ${service} (HTTP ${response.status}): response was not JSON.`, {
      code: "invalid_json_response",
      exitCodeName: "data",
      nextAction: "Retry with --trace to inspect the response status, headers, and body preview."
    });
  }
}

export function httpError(response: HttpTextResponse, payload?: unknown): CliError {
  if (response.status === 401 || response.status === 403) {
    return new CliError(
      `Authentication failed (HTTP ${response.status}). Run \`nitrosend whoami\` to verify your key, or check ${hostFor(response.url)} is reachable from your network.`,
      {
        code: "authentication_failed",
        exitCodeName: "permission",
        retriable: false
      }
    );
  }

  const message = messageFromPayload(payload) || `Nitrosend API request failed (HTTP ${response.status}).`;
  return new CliError(message, {
    code: "http_error",
    exitCodeName: exitCodeForStatus(response.status),
    retriable: response.status >= 500 || response.status === 429
  });
}

function networkError(url: string, message: string): CliError {
  return new CliError(`Could not reach ${hostFor(url)}: ${message}`, {
    code: "network_error",
    exitCodeName: "unavailable",
    retriable: true,
    nextAction: `Check your network connection and that ${hostFor(url)} is reachable.`
  });
}

function shouldPreviewBody(response: Response, text: string, mode: "errors" | "always" | "never"): boolean {
  if (mode === "never") return false;
  if (mode === "always") return text.length > 0;
  return text.length > 0 && (!response.ok || !looksJson(response.headers.get("content-type") || "", text));
}

function looksJson(contentType: string, text: string): boolean {
  if (contentType.toLowerCase().includes("json")) return true;
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function previewBody(text: string): string {
  return redact(text.replace(/\s+/g, " ").trim().slice(0, 200));
}

function traceHeaders(headers: Headers): Record<string, string> | undefined {
  const keep = ["content-type", "retry-after", "x-request-id", "x-nitrosend-cli-latest"];
  const result: Record<string, string> = {};
  for (const key of keep) {
    const value = headers.get(key);
    if (value) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

function messageFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  const message = record.message;
  return typeof message === "string" && message ? message : undefined;
}

function exitCodeForStatus(status: number): ExitCodeName {
  if (status === 404 || status === 400 || status === 422) return "data";
  if (status === 429 || status >= 500) return "unavailable";
  return "data";
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
