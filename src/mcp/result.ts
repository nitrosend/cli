import { ExitCodeName } from "../contracts/exit-codes.js";
import { SafetyClass } from "../contracts/types.js";

export interface McpTextContent {
  type?: string;
  text?: string;
}

export interface McpResourceContent {
  uri?: string;
  mimeType?: string;
  text?: string;
}

export interface McpToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: McpToolAnnotations;
}

export interface ToolListResult {
  tools: McpTool[];
}

export interface ToolCallResult {
  content?: McpTextContent[];
  isError?: boolean;
}

export interface ResourceReadResult {
  contents?: McpResourceContent[];
}

export interface McpResultError {
  code: string;
  message: string;
  retriable: boolean;
  exitCodeName: ExitCodeName;
}

export type InterpretedResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: McpResultError };

export function interpretToolResult(result: ToolCallResult): InterpretedResult<ToolCallResult> {
  if (!result.isError) return { ok: true, value: result };

  const parsed = firstJsonObject(result.content?.map((item) => item.text));
  if (parsed && parsed.error === true) {
    return { ok: false, error: errorFromEnvelope(parsed) };
  }

  const message = result.content
    ?.map((item) => item.text)
    .filter((text): text is string => Boolean(text))
    .join("\n")
    .trim();

  return {
    ok: false,
    error: {
      code: "mcp_tool_error",
      message: message || "MCP tool returned an error",
      retriable: false,
      exitCodeName: "data"
    }
  };
}

export function interpretResourceResult(result: ResourceReadResult): InterpretedResult<ResourceReadResult> {
  const parsed = firstJsonObject(result.contents?.map((item) => item.text));
  if (parsed && parsed.error === true) {
    return { ok: false, error: errorFromEnvelope(parsed) };
  }

  return { ok: true, value: result };
}

export function parseToolJson<T = unknown>(result: ToolCallResult): T | null {
  const parsed = firstJsonObject(result.content?.map((item) => item.text));
  return parsed as T | null;
}

export function safetyClassFromTool(tool: McpTool | undefined, fallbackName?: string): SafetyClass {
  const annotations = tool?.annotations;
  if (annotations?.destructiveHint === true) return "destructive";
  if (annotations?.readOnlyHint === true) return "read";

  return safetyClassFromToolName(tool?.name || fallbackName || "");
}

export function hasSafetyAnnotations(tool: McpTool | undefined): boolean {
  const annotations = tool?.annotations;
  return Boolean(annotations && (
    annotations.destructiveHint !== undefined ||
    annotations.readOnlyHint !== undefined ||
    annotations.idempotentHint !== undefined ||
    annotations.openWorldHint !== undefined
  ));
}

export function safetyClassFromToolName(name: string): SafetyClass {
  if (!name) return "external-effect";
  if (/billing/i.test(name)) return "billing";
  if (/provider|credential/i.test(name)) return "provider-credential";
  if (/^nitro_(delete|destroy|control)_/.test(name)) return "destructive";
  if (/^nitro_send_/.test(name)) return "external-effect";
  if (/^nitro_(manage|configure|set|import|ingest|compose|define)_/.test(name)) return "mutating";
  if (/^nitro_(get|query|search|review)_/.test(name)) return "read";
  return "external-effect";
}

export function findTool(tools: ToolListResult | null | undefined, name: string): McpTool | undefined {
  return tools?.tools.find((tool) => tool.name === name);
}

function errorFromEnvelope(envelope: Record<string, unknown>): McpResultError {
  const code = typeof envelope.code === "string" ? envelope.code : "mcp_result_error";
  const message = typeof envelope.message === "string" ? envelope.message : "MCP result returned an error";
  return {
    code,
    message,
    retriable: code === "unavailable" || code === "temporary_failure",
    exitCodeName: exitCodeNameForMcpCode(code)
  };
}

function exitCodeNameForMcpCode(code: string): ExitCodeName {
  if (code === "unavailable" || code === "service_unavailable") return "unavailable";
  if (code === "unsupported") return "unsupported";
  if (code === "permission_denied" || code === "not_authenticated" || code === "forbidden") return "permission";
  if (code === "temporary_failure" || code === "timeout") return "temporary";
  return "data";
}

function firstJsonObject(values: Array<string | undefined> | undefined): Record<string, unknown> | null {
  for (const value of values || []) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
