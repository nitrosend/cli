export const SCHEMA_VERSION = 1 as const;

export type OutputMode = "tty" | "json" | "ndjson" | "csv";

export type SafetyClass =
  | "read"
  | "local-state"
  | "dry-run-mutating"
  | "mutating"
  | "external-effect"
  | "destructive"
  | "billing"
  | "provider-credential";

export type CacheMode = "none" | "read-through" | "write-through";
export type IdempotencyMode = "none" | "auto" | "required";

export interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: unknown;
  enum?: unknown[];
  description?: string;
}

export interface CommandExample {
  description: string;
  command: string;
}

export interface CommandDescriptor {
  name: string;
  aliases?: string[];
  group: string;
  summary: string;
  usage: string;
  input_schema: JsonSchemaLike;
  output_schema: JsonSchemaLike;
  examples: CommandExample[];
  safety: {
    class: SafetyClass;
    supports_dry_run: boolean;
    requires_confirmation: boolean;
    confirmation_target?: string;
  };
  cache: {
    mode: CacheMode;
    ttl_seconds?: number;
  };
  idempotency: {
    mode: IdempotencyMode;
  };
  agent: {
    suitable: boolean;
    reason?: string;
  };
}

export interface CommandSidecars {
  blockers?: string[];
  warnings?: string[];
  feedback?: unknown;
  memory_delta?: unknown;
  nitrowheel_context?: unknown;
  next_action?: string;
  suggested_tool_calls?: unknown[];
}

export interface TablePresentation {
  type: "table";
  columns: Array<{ key: string; label: string }>;
}

export interface KeyValuePresentation {
  type: "key_value";
}

export interface PreviewPresentation {
  type: "preview";
  title: string;
  blast_radius?: string[];
}

export type Presentation = TablePresentation | KeyValuePresentation | PreviewPresentation;

export interface TraceEvent {
  name: string;
  duration_ms: number;
  request_url?: string;
  request_method?: string;
  response_status?: number;
  response_content_type?: string;
  response_headers?: Record<string, string>;
  response_body_preview?: string;
  error?: string;
}

export interface CommandMeta {
  environment?: string;
  profile?: string;
  dry_run?: boolean;
  cached?: boolean;
  stale?: boolean;
  idempotency_key?: string;
  duration_ms?: number;
  trace?: TraceEvent[];
}

export interface CommandResult<T = unknown> {
  schema_version: typeof SCHEMA_VERSION;
  ok: true;
  command: string;
  data: T;
  sidecars?: CommandSidecars;
  meta: CommandMeta;
  presentation?: Presentation;
}

export interface CommandErrorDetail {
  code: string;
  message: string;
  blockers?: string[];
  next_action?: string;
  suggested_tool_call?: unknown;
  retriable: boolean;
  doc_url?: string;
}

export interface CommandErrorEnvelope {
  schema_version: typeof SCHEMA_VERSION;
  ok: false;
  command?: string;
  error: CommandErrorDetail;
  meta: CommandMeta;
}

export interface StreamEvent {
  schema_version: typeof SCHEMA_VERSION;
  type: "started" | "progress" | "tool_call" | "approval_required" | "completed" | "error";
  command: string;
  data: unknown;
  meta?: CommandMeta;
}

export function commandResult<T>(
  command: string,
  data: T,
  options: {
    meta?: CommandMeta;
    sidecars?: CommandSidecars;
    presentation?: Presentation;
  } = {}
): CommandResult<T> {
  return {
    schema_version: SCHEMA_VERSION,
    ok: true,
    command,
    data,
    meta: options.meta ?? {},
    sidecars: options.sidecars,
    presentation: options.presentation
  };
}
