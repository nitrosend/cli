import { commandNames, findDescriptor } from "../contracts/descriptors.js";
import { CliError } from "../errors.js";
import { didYouMean } from "./suggestions.js";
import { CommandExecution } from "./types.js";

export function resolveExecution(positionals: string[]): Omit<CommandExecution, "flags"> {
  if (positionals.length === 0) {
    return executionFor("dashboard", []);
  }

  for (let length = Math.min(3, positionals.length); length >= 1; length--) {
    const candidate = positionals.slice(0, length).join(" ");
    const descriptor = findDescriptor(candidate);
    if (descriptor) {
      return {
        descriptor,
        commandName: descriptor.name,
        rest: positionals.slice(length)
      };
    }
  }

  throw unknownCommand(positionals.join(" "));
}

export function unknownCommand(command: string): CliError {
  const suggestion = didYouMean(command, commandNames());
  return new CliError(`Unknown command: ${command}${suggestion ? `. Did you mean \`${suggestion}\`?` : ""}`, {
    code: "unknown_command",
    exitCodeName: "usage",
    nextAction: "Run `nitrosend --help` or `nitrosend describe <command>`."
  });
}

function executionFor(commandName: string, rest: string[]): Omit<CommandExecution, "flags"> {
  const descriptor = findDescriptor(commandName);
  if (!descriptor) throw unknownCommand(commandName);
  return { descriptor, commandName: descriptor.name, rest };
}
