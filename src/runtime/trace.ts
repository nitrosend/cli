import { AsyncLocalStorage } from "node:async_hooks";
import { TraceEvent } from "../contracts/types.js";

export interface TraceStore {
  enabled: boolean;
  events: TraceEvent[];
}

const storage = new AsyncLocalStorage<TraceStore>();

export function createTraceStore(enabled: boolean): TraceStore {
  return { enabled, events: [] };
}

export function runWithTraceStore<T>(store: TraceStore, callback: () => Promise<T>): Promise<T> {
  return storage.run(store, callback);
}

export function recordTrace(event: TraceEvent): void {
  const store = storage.getStore();
  if (!store?.enabled) return;
  store.events.push(event);
}

export function traceMeta(store: TraceStore | undefined, totalDurationMs: number): TraceEvent[] | undefined {
  if (!store?.enabled) return undefined;
  return [
    ...store.events,
    {
      name: "total",
      duration_ms: totalDurationMs
    }
  ];
}

export function renderTraceLines(trace: TraceEvent[] | undefined): string {
  if (!trace?.length) return "";
  return trace.map((event) => {
    const parts = [`trace ${event.name}`, `${event.duration_ms}ms`];
    if (event.request_method) parts.push(`method=${event.request_method}`);
    if (event.request_url) parts.push(`url=${event.request_url}`);
    if (event.response_status !== undefined) parts.push(`status=${event.response_status}`);
    if (event.response_content_type) parts.push(`content_type=${event.response_content_type}`);
    if (event.error) parts.push(`error=${JSON.stringify(event.error)}`);
    if (event.response_body_preview) parts.push(`body=${JSON.stringify(event.response_body_preview)}`);
    return parts.join(" ");
  }).join("\n") + "\n";
}
