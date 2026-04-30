import { COMMAND_DESCRIPTORS } from "../contracts/descriptors.js";
import { CURRENT_VERSION } from "../version/current.js";

export function helpText(): string {
  return `Nitrosend CLI ${CURRENT_VERSION}

Usage:
  nitrosend <command> [options]

Commands:
${COMMAND_DESCRIPTORS.filter((descriptor) => descriptor.name).map((descriptor) => `  ${descriptor.usage.padEnd(58)} ${descriptor.summary}`).join("\n")}

Global options:
  --json, --ndjson, --csv, --machine, --non-interactive, --dry-run, --yes, --explain, --trace
`;
}
