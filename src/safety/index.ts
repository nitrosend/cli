import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { CommandDescriptor } from "../contracts/types.js";
import { CliError } from "../errors.js";

export interface SafetyOptions {
  dryRun: boolean;
  yes: boolean;
  nonInteractive: boolean;
  confirm?: string;
  environment?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export async function enforceSafety(
  descriptor: CommandDescriptor,
  target: string | undefined,
  options: SafetyOptions
): Promise<void> {
  if (options.dryRun && !descriptor.safety.supports_dry_run) {
    throw new CliError(`${descriptor.name} does not support --dry-run`, {
      code: "dry_run_unsupported",
      exitCodeName: "usage",
      nextAction: `Run \`nitrosend describe ${descriptor.name}\` to inspect command safety.`
    });
  }

  const requiresTypedConfirmation = descriptor.safety.requires_confirmation ||
    (options.environment === "production" && descriptor.safety.class === "destructive");

  if (!requiresTypedConfirmation || options.dryRun) return;

  const expected = target || descriptor.safety.confirmation_target;
  if (!expected) {
    throw new CliError("Confirmation target is missing", {
      code: "confirmation_target_missing",
      exitCodeName: "data"
    });
  }

  if (options.confirm === expected) return;

  if (options.confirm !== undefined) {
    throw new CliError("Confirmation does not match expected target", {
      code: "confirmation_mismatch_explicit",
      exitCodeName: "usage"
    });
  }

  if (options.yes || options.nonInteractive) {
    throw new CliError(`Typed confirmation required: rerun with --confirm ${expected}`, {
      code: "typed_confirmation_required",
      exitCodeName: "permission",
      blockers: ["This command cannot be approved with --yes or in non-interactive mode."],
      nextAction: `Rerun with --confirm ${expected} after reviewing the dry-run preview.`
    });
  }

  const input = options.stdin ?? defaultStdin;
  if ((input as NodeJS.ReadStream & { isTTY?: boolean }).isTTY !== true) {
    throw new CliError(`Typed confirmation required: rerun with --confirm ${expected}`, {
      code: "typed_confirmation_required",
      exitCodeName: "permission",
      blockers: ["This command cannot be approved with --yes or in non-interactive mode."],
      nextAction: `Rerun with --confirm ${expected} after reviewing the dry-run preview.`
    });
  }

  const readline = createInterface({
    input,
    output: options.stdout ?? defaultStdout
  });
  try {
    const answer = await readline.question(`Type ${expected} to continue: `);
    if (answer !== expected) {
      throw new CliError("Confirmation did not match", {
        code: "confirmation_mismatch",
        exitCodeName: "permission"
      });
    }
  } finally {
    readline.close();
  }
}
