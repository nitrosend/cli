import { flagBoolean, flagString } from "../args.js";
import { KNOWN_FLAGS } from "../contracts/descriptors.js";
import { OutputMode } from "../contracts/types.js";
import { CliError } from "../errors.js";
import { didYouMean } from "./suggestions.js";
import { RuntimeOptions } from "./types.js";



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
    idempotencyKey: flagString(flags, "idempotency-key"),
    profile: flagString(flags, "profile"),
    apiUrl: flagString(flags, "api-url")
  };
}

// .nitrosend.yml supplies the profile, API URL and output a project uses; a
// flag still wins.
export function withProjectDefaults(
  runtime: RuntimeOptions,
  flags: Record<string, string | boolean>,
  project: { profile?: string; apiUrl?: string; output?: OutputMode }
): RuntimeOptions {
  const outputFlagged = ["machine", "json", "ndjson", "csv"].some((flag) => flagBoolean(flags, flag));
  return {
    ...runtime,
    profile: runtime.profile || project.profile,
    apiUrl: runtime.apiUrl || project.apiUrl,
    outputMode: outputFlagged || !project.output ? runtime.outputMode : project.output
  };
}

export function assertKnownFlags(flags: Record<string, string | boolean>): void {
  for (const flag of Object.keys(flags)) {
    if (KNOWN_FLAGS.has(flag)) continue;
    const suggestion = didYouMean(flag, [...KNOWN_FLAGS.keys()]);
    throw new CliError(`Unknown flag --${flag}${suggestion ? `. Did you mean --${suggestion}?` : ""}`, {
      code: "unknown_flag",
      exitCodeName: "usage"
    });
  }
}
