import { KNOWN_FLAGS } from "./contracts/descriptors.js";
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
      if (isBooleanFlag(name)) {
        flags[name] = booleanValue(name, inlineValue);
      } else if (inlineValue !== undefined && inlineValue !== "") {
        flags[name] = inlineValue;
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

// A boolean flag is any flag a usage line writes without a value.
function isBooleanFlag(name: string): boolean {
  return KNOWN_FLAGS.get(name)?.type === "boolean";
}

function booleanValue(name: string, inlineValue: string | undefined): boolean {
  if (inlineValue === undefined || inlineValue === "true") return true;
  if (inlineValue === "false") return false;
  throw new CliError(`--${name} takes no value`, { code: "invalid_flag_value", exitCodeName: "usage" });
}
