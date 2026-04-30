import { parseArgs, flagBoolean, flagString } from "../args.js";
import { loginWithApiKey, loginWithOAuth, logout, resolveAuth } from "../auth.js";
import { currentProfile, defaultApiUrl } from "../config.js";
import { commandNames, findDescriptor } from "../contracts/descriptors.js";
import { commandResult, CommandDescriptor, CommandMeta } from "../contracts/types.js";
import { ProjectContext } from "../context/project.js";
import { CliError } from "../errors.js";
import { readHistory } from "../history.js";
import { McpClient } from "../mcp/client.js";
import { RuntimeOptions, CommandExecution } from "../runtime/types.js";
import { unknownCommand } from "../runtime/resolve.js";

export async function executeCommand(
  execution: CommandExecution,
  runtime: RuntimeOptions,
  projectContext: ProjectContext
) {
  const meta: CommandMeta = {
    environment: projectContext.environment,
    profile: runtime.profile || projectContext.profile,
    dry_run: runtime.dryRun || undefined,
    idempotency_key: runtime.idempotencyKey
  };

  switch (execution.commandName) {
    case "dashboard":
      return commandResult("dashboard", await dashboardData(runtime, projectContext), {
        meta,
        sidecars: {
          blockers: [],
          next_action: "Run `nitrosend describe mcp tools list` or `nitrosend mcp tools list --json`.",
          suggested_tool_calls: [{ name: "nitro_get_status", arguments: {} }]
        }
      });
    case "login":
      return commandResult("login", await loginCommand(execution.rest, execution.flags, runtime), { meta });
    case "logout": {
      const profile = await logout();
      return commandResult("logout", { profile, status: profile ? "logged_out" : "no_active_profile" }, { meta });
    }
    case "whoami":
      return commandResult("whoami", await whoamiData(runtime), { meta, presentation: { type: "key_value" } });
    case "describe":
      return commandResult("describe", describeCommand(execution.rest), { meta });
    case "completion":
      return commandResult("completion", completionCommand(execution.rest), { meta });
    case "recent":
      return commandResult("recent", await recentData(), {
        meta,
        presentation: {
          type: "table",
          columns: [{ key: "index", label: "Index" }, { key: "timestamp", label: "When" }, { key: "command", label: "Command" }]
        }
      });
    case "redo":
      return commandResult("redo", await redoData(execution.rest), { meta });
    case "fixture destroy":
      return commandResult("fixture destroy", fixtureDestroyData(execution.rest, runtime), {
        meta,
        presentation: {
          type: "preview",
          title: runtime.dryRun ? "Dry-run destructive fixture preview" : "Destroyed fixture",
          blast_radius: [`fixture:${execution.rest[0] || "unknown"}`]
        }
      });
    case "approve":
    case "reject":
      return commandResult(execution.commandName, approvalData(execution), { meta });
    default:
      if (execution.commandName.startsWith("mcp ")) {
        return commandResult(execution.commandName, await executeMcp(execution, runtime), { meta });
      }
      throw new CliError(`No handler for ${execution.commandName}`, { code: "handler_missing", exitCodeName: "internal" });
  }
}

export function explainResult(execution: CommandExecution, runtime: RuntimeOptions, projectContext: ProjectContext) {
  return commandResult("explain", {
    command: execution.commandName,
    descriptor: execution.descriptor,
    resolved_context: {
      profile: runtime.profile || projectContext.profile || "default",
      environment: projectContext.environment,
      project_config: projectContext.path || null
    },
    would_execute: false,
    idempotency_key: runtime.idempotencyKey,
    output_mode: runtime.outputMode
  }, {
    meta: {
      environment: projectContext.environment,
      idempotency_key: runtime.idempotencyKey,
      dry_run: runtime.dryRun || undefined
    }
  });
}

async function loginCommand(
  rest: string[],
  inheritedFlags: Record<string, string | boolean>,
  runtime: RuntimeOptions
): Promise<Record<string, unknown>> {
  const parsed = parseArgs(rest);
  const flags = { ...inheritedFlags, ...parsed.flags };
  const profile = flagString(flags, "profile") || runtime.profile || "default";
  const apiUrl = flagString(flags, "api-url") || runtime.apiUrl || defaultApiUrl();
  const apiKey = flagString(flags, "api-key");

  if (apiKey) {
    await loginWithApiKey(apiKey, { profile, apiUrl });
    return { profile, auth: "api_key", apiUrl };
  }

  if (runtime.nonInteractive) {
    throw new CliError("OAuth login requires an interactive browser", {
      code: "interactive_required",
      exitCodeName: "permission"
    });
  }

  const saved = await loginWithOAuth({
    profile,
    apiUrl,
    openBrowser: !flagBoolean(flags, "no-browser")
  });
  return { profile: saved.name, auth: "oauth", apiUrl: saved.apiUrl };
}

async function whoamiData(runtime: RuntimeOptions): Promise<Record<string, unknown>> {
  const auth = await resolveAuth(runtime.profile);
  const profile = auth.source === "profile" ? await currentProfile() : null;
  return {
    auth: auth.tokenType,
    source: auth.source,
    profile: auth.profileName,
    apiUrl: auth.apiUrl,
    expiresAt: profile?.expiresAt
  };
}

async function dashboardData(runtime: RuntimeOptions, projectContext: ProjectContext): Promise<Record<string, unknown>> {
  let authState: Record<string, unknown>;
  try {
    authState = await whoamiData(runtime);
  } catch {
    authState = { source: "none", next_action: "Run `nitrosend login` or set NITROSEND_API_KEY." };
  }

  return {
    profile: authState.profile || projectContext.profile || "default",
    environment: projectContext.environment,
    project_config: projectContext.path || null,
    auth: authState,
    blockers: authState.source === "none" ? ["No active credentials"] : [],
    suggested_actions: [
      "nitrosend mcp tools list --json",
      "nitrosend describe mcp tools call",
      "nitrosend recent"
    ]
  };
}

function describeCommand(rest: string[]): CommandDescriptor {
  const name = rest.join(" ").trim();
  const descriptor = findDescriptor(name);
  if (!descriptor) {
    throw unknownCommand(name || "describe");
  }
  return descriptor;
}

function completionCommand(rest: string[]): string {
  const shell = rest[0];
  const names = commandNames();
  if (shell === "bash") return `complete -W "${names.join(" ")}" nitrosend\n`;
  if (shell === "zsh") return `#compdef nitrosend\n_arguments '1:command:(${names.join(" ")})'\n`;
  if (shell === "fish") return names.map((name) => `complete -c nitrosend -a '${name}'`).join("\n") + "\n";
  throw new CliError("Usage: nitrosend completion <bash|zsh|fish>", { code: "usage_error", exitCodeName: "usage" });
}

async function recentData(): Promise<{ rows: Array<Record<string, unknown>> }> {
  const rows = (await readHistory()).slice(0, 10).map((entry, index) => ({
    index: index + 1,
    timestamp: entry.timestamp,
    command: entry.command
  }));
  return { rows };
}

async function redoData(rest: string[]): Promise<Record<string, unknown>> {
  const index = Number(rest[0] || "1") - 1;
  const entries = await readHistory();
  const entry = entries[index];
  if (!entry) {
    throw new CliError("No recent command at that index", {
      code: "history_not_found",
      exitCodeName: "data"
    });
  }
  return {
    selected: index + 1,
    command: entry.command,
    status: "ready",
    next_action: "Rerun the command manually after review."
  };
}

function fixtureDestroyData(rest: string[], runtime: RuntimeOptions): Record<string, unknown> {
  const name = rest[0];
  if (!name) throw new CliError("Usage: nitrosend fixture destroy <name>", { code: "usage_error", exitCodeName: "usage" });
  return {
    name,
    dry_run: runtime.dryRun,
    status: runtime.dryRun ? "would_destroy" : "destroyed",
    affected: [`fixture:${name}`]
  };
}

function approvalData(execution: CommandExecution): Record<string, unknown> {
  const token = execution.rest[0];
  if (!token) throw new CliError(`Usage: nitrosend ${execution.commandName} <token>`, { code: "usage_error", exitCodeName: "usage" });
  return {
    token,
    status: "unsupported_until_agent_endpoint",
    next_action: "Run this after the CLI SSE agent endpoint ships."
  };
}

async function executeMcp(execution: CommandExecution, runtime: RuntimeOptions): Promise<unknown> {
  const auth = await resolveAuth(runtime.profile);
  const client = new McpClient({ auth });
  const args = parseJsonObject(flagString(execution.flags, "args") || flagString(execution.flags, "json-args") || "{}");
  const rest = execution.rest;

  switch (execution.commandName) {
    case "mcp initialize":
      return client.initialize();
    case "mcp tools list":
      return client.listTools();
    case "mcp tools call":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp tools call <name> --args '{...}'", { code: "usage_error", exitCodeName: "usage" });
      return client.callTool(rest[0], args);
    case "mcp resources list":
      return client.listResources();
    case "mcp resources read":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp resources read <uri>", { code: "usage_error", exitCodeName: "usage" });
      return client.readResource(rest[0]);
    case "mcp prompts list":
      return client.listPrompts();
    case "mcp prompts get":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp prompts get <name> --args '{...}'", { code: "usage_error", exitCodeName: "usage" });
      return client.getPrompt(rest[0], args);
    default:
      throw unknownCommand(execution.commandName);
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new CliError(`Invalid JSON args: ${(error as Error).message}`, {
      code: "invalid_json_args",
      exitCodeName: "data"
    });
  }
  throw new CliError("JSON args must be an object", { code: "invalid_json_args", exitCodeName: "data" });
}
