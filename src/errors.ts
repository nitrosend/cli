import { CommandErrorEnvelope, CommandMeta, SCHEMA_VERSION } from "./contracts/types.js";
import { EXIT_CODES, ExitCodeName } from "./contracts/exit-codes.js";

export interface CliErrorOptions {
  exitCode?: number;
  code?: string;
  exitCodeName?: ExitCodeName;
  blockers?: string[];
  nextAction?: string;
  suggestedToolCall?: unknown;
  retriable?: boolean;
  docUrl?: string;
}

export class CliError extends Error {
  readonly exitCode: number;
  readonly code: string;
  readonly blockers?: string[];
  readonly nextAction?: string;
  readonly suggestedToolCall?: unknown;
  readonly retriable: boolean;
  readonly docUrl?: string;

  constructor(message: string, options: CliErrorOptions | number = {}) {
    super(message);
    this.name = "CliError";

    if (typeof options === "number") {
      this.exitCode = options;
      this.code = "cli_error";
      this.retriable = false;
      return;
    }

    this.exitCode = options.exitCode ?? (options.exitCodeName ? EXIT_CODES[options.exitCodeName] : EXIT_CODES.usage);
    this.code = options.code ?? "cli_error";
    this.blockers = options.blockers;
    this.nextAction = options.nextAction;
    this.suggestedToolCall = options.suggestedToolCall;
    this.retriable = options.retriable ?? this.exitCode === EXIT_CODES.temporary;
    this.docUrl = options.docUrl;
  }
}

export function isCliError(error: unknown): error is CliError | { message: string; exitCode: number } {
  return error instanceof Error && "exitCode" in error && typeof (error as { exitCode: unknown }).exitCode === "number";
}

export function errorEnvelope(
  error: unknown,
  options: { command?: string; meta?: CommandMeta } = {}
): CommandErrorEnvelope {
  const cliError = error instanceof CliError ? error : null;
  const message = error instanceof Error ? error.message : String(error);

  return {
    schema_version: SCHEMA_VERSION,
    ok: false,
    command: options.command,
    error: {
      code: cliError?.code ?? codeFromExit(error),
      message,
      blockers: cliError?.blockers,
      next_action: cliError?.nextAction,
      suggested_tool_call: cliError?.suggestedToolCall,
      retriable: cliError?.retriable ?? false,
      doc_url: cliError?.docUrl
    },
    meta: options.meta ?? {}
  };
}

export function exitCodeFor(error: unknown): number {
  return isCliError(error) ? error.exitCode : EXIT_CODES.internal;
}

function codeFromExit(error: unknown): string {
  if (isCliError(error)) {
    if (error.exitCode === EXIT_CODES.permission) return "permission_denied";
    if (error.exitCode === EXIT_CODES.unsupported) return "unsupported";
    if (error.exitCode === EXIT_CODES.temporary) return "temporary_failure";
    if (error.exitCode === EXIT_CODES.data) return "validation_failed";
  }
  return "internal_error";
}
