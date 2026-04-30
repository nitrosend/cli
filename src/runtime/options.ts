import { flagBoolean, flagString } from "../args.js";
import { OutputMode } from "../contracts/types.js";
import { CliError } from "../errors.js";
import { didYouMean } from "./suggestions.js";
import { RuntimeOptions } from "./types.js";

const GLOBAL_FLAGS = new Set([
  "help",
  "version",
  "json",
  "ndjson",
  "csv",
  "no-color",
  "no-pager",
  "non-interactive",
  "machine",
  "trace",
  "dry-run",
  "yes",
  "explain",
  "profile",
  "api-url",
  "api-key",
  "args",
  "json-args",
  "confirm",
  "no-browser"
]);

export function runtimeOptions(flags: Record<string, string | boolean>): RuntimeOptions {
  const machine = flagBoolean(flags, "machine");
  const outputMode: OutputMode = machine || flagBoolean(flags, "json")
    ? "json"
    : flagBoolean(flags, "ndjson")
      ? "ndjson"
      : flagBoolean(flags, "csv")
        ? "csv"
        : "tty";

  return {
    outputMode,
    color: !(machine || flagBoolean(flags, "no-color")),
    nonInteractive: machine || flagBoolean(flags, "non-interactive"),
    machine,
    trace: flagBoolean(flags, "trace"),
    dryRun: flagBoolean(flags, "dry-run"),
    yes: flagBoolean(flags, "yes"),
    explain: flagBoolean(flags, "explain"),
    confirm: flagString(flags, "confirm"),
    profile: flagString(flags, "profile"),
    apiUrl: flagString(flags, "api-url"),
    idempotencyKey: machine ? `cli-${Date.now().toString(36)}` : undefined
  };
}

export function assertKnownFlags(flags: Record<string, string | boolean>): void {
  for (const flag of Object.keys(flags)) {
    if (GLOBAL_FLAGS.has(flag)) continue;
    const suggestion = didYouMean(flag, [...GLOBAL_FLAGS]);
    throw new CliError(`Unknown flag --${flag}${suggestion ? `. Did you mean --${suggestion}?` : ""}`, {
      code: "unknown_flag",
      exitCodeName: "usage"
    });
  }
}
