import { COMMAND_DESCRIPTORS, GLOBAL_OPTIONS } from "../contracts/descriptors.js";
import { CommandDescriptor } from "../contracts/types.js";
import { CURRENT_VERSION } from "../version/current.js";

export function helpText(): string {
  return `Nitrosend CLI ${CURRENT_VERSION}

Usage:
  nitrosend <command> [options]
  nitrosend <command> --help

Commands:
${COMMAND_DESCRIPTORS.filter((descriptor) => descriptor.name).map((descriptor) => `  ${descriptor.usage.padEnd(58)} ${descriptor.summary}`).join("\n")}

Global options:
  ${globalOptions()}
`;
}

export function commandHelpText(descriptor: CommandDescriptor): string {
  const examples = descriptor.examples.map((example) => `  ${example.command}\n      ${example.description}`).join("\n");
  const agent = descriptor.agent.reason ? `\nAgents: ${descriptor.agent.reason}\n` : "";
  return `${descriptor.summary}

Usage:
  ${descriptor.usage}

Examples:
${examples}

Safety: ${descriptor.safety.class}${descriptor.safety.supports_dry_run ? ", supports --dry-run" : ""}${descriptor.safety.requires_confirmation ? ", asks for confirmation" : ""}
${agent}
Global options:
  ${globalOptions()}

Machine-readable: nitrosend describe ${descriptor.name || "dashboard"} --json
`;
}

function globalOptions(): string {
  return GLOBAL_OPTIONS.map((option) => `--${option.name}${option.placeholder ? ` ${option.placeholder}` : ""}`).join(", ");
}
