import { randomUUID } from "node:crypto";
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
import { createTraceStore, renderTraceLines, runWithTraceStore, traceMeta, TraceStore } from "./runtime/trace.js";
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
  let traceStore: TraceStore | undefined;

  try {
    const parsed = parseArgs(options.argv);
    assertKnownFlags(parsed.flags);
    let activeRuntime = runtimeOptions(parsed.flags);
    runtime = activeRuntime;
    traceStore = createTraceStore(activeRuntime.trace);

    return await runWithTraceStore(traceStore, async () => {
      if (flagBoolean(parsed.flags, "help")) {
        stdout.write(helpText());
        return EXIT_CODES.ok;
      }

      if (flagBoolean(parsed.flags, "version")) {
        stdout.write(`${CURRENT_VERSION}\n`);
        return EXIT_CODES.ok;
      }

      projectContext = await loadProjectContext(options.cwd);
      const execution = { ...resolveExecution(parsed.positionals), flags: parsed.flags };
      parsedCommand = execution.commandName;
      if (execution.descriptor.idempotency.mode === "auto" && !activeRuntime.idempotencyKey) {
        activeRuntime = { ...activeRuntime, idempotencyKey: `cli-${randomUUID()}` };
        runtime = activeRuntime;
      }

      if (activeRuntime.explain) {
        const result = await explainResult(execution, activeRuntime, projectContext);
        stdout.write(renderResult(result, { mode: activeRuntime.outputMode, color: activeRuntime.color }));
        return EXIT_CODES.ok;
      }

      await enforceSafety(execution.descriptor, execution.rest[0], {
        dryRun: activeRuntime.dryRun,
        yes: activeRuntime.yes,
        nonInteractive: activeRuntime.nonInteractive,
        confirm: activeRuntime.confirm,
        environment: projectContext.environment,
        stdin: options.stdin,
        stdout: process.stderr
      });

      const result = await executeCommand(execution, activeRuntime, projectContext);
      result.meta.duration_ms = Math.round(performance.now() - startedAt);
      result.meta.trace = traceMeta(traceStore, result.meta.duration_ms);
      if (activeRuntime.trace) stderr.write(redact(renderTraceLines(result.meta.trace)));

      if (execution.commandName === "completion" && activeRuntime.outputMode === "tty") {
        stdout.write(String(result.data));
      } else {
        stdout.write(renderResult(result, { mode: activeRuntime.outputMode, color: activeRuntime.color }));
      }

      await recordHistory(options.argv);
      return EXIT_CODES.ok;
    });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const trace = traceMeta(traceStore, durationMs);
    const envelope = errorEnvelope(error, {
      command: parsedCommand,
      meta: {
        environment: projectContext?.environment,
        duration_ms: durationMs,
        trace
      }
    });
    const mode = runtime?.outputMode ?? "tty";
    const rendered = renderError(envelope, { mode, color: runtime?.color ?? true });
    if (mode === "json" || mode === "ndjson") {
      stdout.write(rendered);
    } else {
      stderr.write(redact(rendered));
    }
    if (runtime?.trace) stderr.write(redact(renderTraceLines(trace)));
    return exitCodeFor(error);
  }
}
