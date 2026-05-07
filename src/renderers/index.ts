import { CommandErrorEnvelope, CommandResult, OutputMode, Presentation, StreamEvent } from "../contracts/types.js";

export interface RenderOptions {
  mode: OutputMode;
  color: boolean;
}

export function renderResult(result: CommandResult, options: RenderOptions): string {
  if (options.mode === "json") return `${JSON.stringify(result, null, 2)}\n`;
  if (options.mode === "ndjson") return renderNdjson(result);
  if (options.mode === "csv") return renderCsv(result);
  return renderTty(result, options);
}

export function renderError(error: CommandErrorEnvelope, options: RenderOptions): string {
  if (options.mode === "json") return `${JSON.stringify(error, null, 2)}\n`;
  if (options.mode === "ndjson") {
    const event: StreamEvent = {
      schema_version: error.schema_version,
      type: "error",
      command: error.command || "unknown",
      data: error.error,
      meta: error.meta
    };
    return `${JSON.stringify(event)}\n`;
  }

  const lines = [`Error: ${error.error.message}`];
  if (error.error.blockers?.length) lines.push(`Blockers: ${error.error.blockers.join("; ")}`);
  if (error.error.next_action) lines.push(`Next action: ${error.error.next_action}`);
  if (error.error.doc_url) lines.push(`Docs: ${error.error.doc_url}`);
  return `${lines.join("\n")}\n`;
}

function renderNdjson(result: CommandResult): string {
  const data = result.data as { events?: unknown[] };
  if (Array.isArray(data?.events)) {
    return data.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  }
  const event: StreamEvent = {
    schema_version: result.schema_version,
    type: "completed",
    command: result.command,
    data: result.data,
    meta: result.meta
  };
  return `${JSON.stringify(event)}\n`;
}

function renderCsv(result: CommandResult): string {
  const rows = rowsFor(result.data);
  if (rows.length === 0) return "\n";
  const columns = Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n") + "\n";
}

function renderTty(result: CommandResult, options: RenderOptions): string {
  const lines: string[] = [];
  const environment = displayEnvironment(result.meta.environment);
  lines.push(colorize(`${titleize(result.command)}${environment}`, "bold", options.color));

  if (result.presentation?.type === "table") {
    lines.push(renderTable(result.data, result.presentation));
  } else if (result.presentation?.type === "preview") {
    lines.push(renderPreview(result));
  } else {
    lines.push(renderKeyValue(result.data));
  }

  const sidecarLines = renderSidecars(result);
  if (sidecarLines.length) lines.push("", ...sidecarLines);
  return `${lines.filter((line) => line !== undefined).join("\n")}\n`;
}

function renderTable(data: unknown, presentation: Presentation): string {
  if (presentation.type !== "table") return renderKeyValue(data);
  const rows = rowsFor(data);
  if (rows.length === 0) return "No rows.";
  const widths = presentation.columns.map((column) => {
    return Math.max(column.label.length, ...rows.map((row) => String(row[column.key] ?? "").length));
  });
  const header = presentation.columns.map((column, index) => column.label.padEnd(widths[index])).join("  ");
  const body = rows.map((row) => {
    return presentation.columns.map((column, index) => String(row[column.key] ?? "").padEnd(widths[index])).join("  ");
  });
  return [header, "-".repeat(header.length), ...body].join("\n");
}

function renderPreview(result: CommandResult): string {
  const presentation = result.presentation?.type === "preview" ? result.presentation : undefined;
  const data = presentation?.blast_radius?.length ? omitRecordKeys(result.data, ["affected"]) : result.data;
  const lines = [presentation?.title || "Preview", renderKeyValue(data)];
  if (presentation?.blast_radius?.length) {
    lines.push("Blast radius:", ...presentation.blast_radius.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function renderKeyValue(data: unknown): string {
  if (data === null || data === undefined) return "OK";
  if (typeof data !== "object") return String(data);
  if (Array.isArray(data)) return data.map((item) => `- ${formatValue(item)}`).join("\n");
  return Object.entries(data as Record<string, unknown>)
    .filter(([, value]) => shouldRenderValue(value))
    .map(([key, value]) => keyValueLine(key, value))
    .join("\n");
}

function renderSidecars(result: CommandResult): string[] {
  const sidecars = result.sidecars;
  if (!sidecars) return [];
  const lines: string[] = [];
  if (sidecars.blockers?.length) lines.push("Blockers:", ...sidecars.blockers.map((item) => `- ${item}`));
  if (sidecars.warnings?.length) lines.push("Warnings:", ...sidecars.warnings.map((item) => `- ${item}`));
  if (sidecars.next_action) lines.push(`Next action: ${sidecars.next_action}`);
  if (sidecars.suggested_tool_calls?.length) lines.push(`Suggested tool calls: ${sidecars.suggested_tool_calls.length}`);
  if (sidecars.feedback) lines.push(`Feedback: ${formatValue(sidecars.feedback)}`);
  if (sidecars.memory_delta) lines.push(`Memory delta: ${formatValue(sidecars.memory_delta)}`);
  if (sidecars.nitrowheel_context) lines.push(`NitroWheel: ${formatValue(sidecars.nitrowheel_context)}`);
  return lines;
}

function rowsFor(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.rows)) return data.rows.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return `\n${value.map((item) => formatListItem(item, 1)).join("\n")}`;
  }
  if (typeof value === "object") {
    return `\n${formatObject(value as Record<string, unknown>, 1)}`;
  }
  return String(value);
}

function keyValueLine(key: string, value: unknown): string {
  const rendered = formatValue(value);
  return rendered.startsWith("\n")
    ? `${humanize(key)}:${rendered}`
    : `${humanize(key)}: ${rendered}`;
}

function formatObject(record: Record<string, unknown>, depth: number): string {
  return Object.entries(record)
    .filter(([, value]) => shouldRenderValue(value))
    .map(([key, value]) => {
      const indent = "  ".repeat(depth);
      const rendered = formatNestedValue(value, depth);
      return rendered.startsWith("\n")
        ? `${indent}${humanize(key)}:${rendered}`
        : `${indent}${humanize(key)}: ${rendered}`;
    })
    .join("\n");
}

function formatNestedValue(value: unknown, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return `\n${value.map((item) => formatListItem(item, depth + 1)).join("\n")}`;
  }
  if (typeof value === "object" && value !== null) {
    return `\n${formatObject(value as Record<string, unknown>, depth + 1)}`;
  }
  return String(value ?? "");
}

function formatListItem(value: unknown, depth: number): string {
  const indent = "  ".repeat(depth);
  if (typeof value === "object" && value !== null) {
    const nested = formatObject(value as Record<string, unknown>, depth + 1);
    return `${indent}-\n${nested}`;
  }
  return `${indent}- ${String(value ?? "")}`;
}

function shouldRenderValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0) return false;
  return true;
}

function omitRecordKeys(data: unknown, keys: string[]): unknown {
  if (!isRecord(data)) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
}

function displayEnvironment(environment: string | undefined): string {
  return environment && environment !== "development" ? ` [${environment}]` : "";
}

function titleize(value: string): string {
  return value.split(" ").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function humanize(value: string): string {
  if (value === "apiUrl" || value === "api_url") return "API URL";
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (match) => match.toUpperCase());
}

function colorize(value: string, style: "bold", enabled: boolean): string {
  if (!enabled) return value;
  return style === "bold" ? `\u001b[1m${value}\u001b[0m` : value;
}
