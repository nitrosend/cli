import { flagBoolean, parseArgs } from "./args.js";
import { executeCommand, explainResult } from "./commands/handlers.js";
import { EXIT_CODES } from "./contracts/exit-codes.js";
import { loadProjectContext, ProjectContext } from "./context/project.js";
import { errorEnvelope, exitCodeFor } from "./errors.js";
import { recordHistory } from "./history.js";
import { renderError, renderResult } from "./renderers/index.js";
import { redact } from "./redact.js";
import { helpText } from "./runtime/help.js";
import { assertKnownFlags, runtimeOptions } from "./runtime/options.js";
import { resolveExecution } from "./runtime/resolve.js";
import { RuntimeOptions } from "./runtime/types.js";
import { enforceSafety } from "./safety/index.js";
import { CURRENT_VERSION } from "./version/current.js";

export interface RunOptions {
  argv: string[];
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  stdin?: NodeJS.ReadableStream;
  cwd?: string;
}

export async function runCli(options: RunOptions): Promise<number> {
  const startedAt = performance.now();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let parsedCommand: string | undefined;
  let runtime: RuntimeOptions | undefined;
  let projectContext: ProjectContext | undefined;

  try {
    const parsed = parseArgs(options.argv);
    assertKnownFlags(parsed.flags);
    runtime = runtimeOptions(parsed.flags);

    if (flagBoolean(parsed.flags, "help")) {
      stdout.write(helpText());
      return EXIT_CODES.ok;
    }

    const [first] = parsed.positionals;
    if (flagBoolean(parsed.flags, "version") || first === "version") {
      stdout.write(`${CURRENT_VERSION}\n`);
      return EXIT_CODES.ok;
    }

    projectContext = await loadProjectContext(options.cwd);
    const execution = { ...resolveExecution(parsed.positionals), flags: parsed.flags };
    parsedCommand = execution.commandName;

    if (runtime.explain) {
      const result = explainResult(execution, runtime, projectContext);
      stdout.write(renderResult(result, { mode: runtime.outputMode, color: runtime.color }));
      return EXIT_CODES.ok;
    }

    await enforceSafety(execution.descriptor, execution.rest[0], {
      dryRun: runtime.dryRun,
      yes: runtime.yes,
      nonInteractive: runtime.nonInteractive,
      confirm: runtime.confirm,
      environment: projectContext.environment,
      stdin: options.stdin,
      stdout: process.stderr
    });

    const result = await executeCommand(execution, runtime, projectContext);
    result.meta.duration_ms = Math.round(performance.now() - startedAt);
    if (runtime.trace) {
      result.meta.trace = [{ name: "total", duration_ms: result.meta.duration_ms }];
      stderr.write(`trace total=${result.meta.duration_ms}ms\n`);
    }

    if (execution.commandName === "completion" && runtime.outputMode === "tty") {
      stdout.write(String(result.data));
    } else {
      stdout.write(renderResult(result, { mode: runtime.outputMode, color: runtime.color }));
    }

    await recordHistory(options.argv);
    return EXIT_CODES.ok;
  } catch (error) {
    const envelope = errorEnvelope(error, {
      command: parsedCommand,
      meta: {
        environment: projectContext?.environment,
        duration_ms: Math.round(performance.now() - startedAt)
      }
    });
    const mode = runtime?.outputMode ?? "tty";
    const rendered = renderError(envelope, { mode, color: runtime?.color ?? true });
    if (mode === "json" || mode === "ndjson") {
      stdout.write(rendered);
    } else {
      stderr.write(redact(rendered));
    }
    return exitCodeFor(error);
  }
}
