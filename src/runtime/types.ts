import { CommandDescriptor, OutputMode } from "../contracts/types.js";

export interface RuntimeOptions {
  outputMode: OutputMode;
  color: boolean;
  nonInteractive: boolean;
  machine: boolean;
  trace: boolean;
  dryRun: boolean;
  yes: boolean;
  explain: boolean;
  confirm?: string;
  profile?: string;
  apiUrl?: string;
  idempotencyKey?: string;
}

export interface CommandExecution {
  descriptor: CommandDescriptor;
  commandName: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}
