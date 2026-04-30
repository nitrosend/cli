import { CliError } from "./errors.js";

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (!name) throw new CliError(`Invalid flag ${arg}`);
      if (inlineValue !== undefined && inlineValue !== "") {
        flags[name] = inlineValue;
      } else if (isBooleanFlag(name)) {
        flags[name] = true;
      } else {
        const next = args[i + 1];
        if (!next || next.startsWith("--")) throw new CliError(`Missing value for --${name}`);
        flags[name] = next;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

export function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBoolean(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}

function isBooleanFlag(name: string): boolean {
  return [
    "help",
    "version",
    "json",
    "ndjson",
    "csv",
    "no-browser",
    "no-color",
    "no-pager",
    "non-interactive",
    "machine",
    "trace",
    "dry-run",
    "yes",
    "explain"
  ].includes(name);
}
