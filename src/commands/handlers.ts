import { parseArgs, flagBoolean, flagString } from "../args.js";
import { loginWithApiKey, loginWithOAuth, logout, resolveAuth } from "../auth.js";
import { readCache, writeCache } from "../cache/cache.js";
import { currentProfile, defaultApiUrl } from "../config.js";
import { COMMAND_DESCRIPTORS, commandNames, findDescriptor } from "../contracts/descriptors.js";
import { commandResult, CommandDescriptor, CommandMeta, CommandResult, CommandSidecars } from "../contracts/types.js";
import { ProjectContext } from "../context/project.js";
import { CliError } from "../errors.js";
import { readHistory } from "../history.js";
import { McpClient } from "../mcp/client.js";
import {
  findTool,
  hasSafetyAnnotations,
  interpretResourceResult,
  interpretToolResult,
  parseToolJson,
  safetyClassFromTool,
  safetyClassFromToolName
} from "../mcp/result.js";
import { RuntimeOptions, CommandExecution } from "../runtime/types.js";
import { resolveExecution, unknownCommand } from "../runtime/resolve.js";
import { CURRENT_VERSION } from "../version/current.js";
import { compareSemver } from "../version/semver.js";

const TOOLS_CACHE_TTL_SECONDS = 900;
const ENTITY_COMMANDS: Record<string, { entity: string; title: string; searchFilter?: string; statusFilter?: boolean }> = {
  "flows list": { entity: "flows", title: "Flows", searchFilter: "search", statusFilter: true },
  "campaigns list": { entity: "campaigns", title: "Campaigns", searchFilter: "search", statusFilter: true },
  "contacts list": { entity: "contacts", title: "Contacts", searchFilter: "query" },
  "lists list": { entity: "lists", title: "Lists", searchFilter: "name" },
  "templates list": { entity: "templates", title: "Templates", searchFilter: "subject" }
};

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
    case "dashboard": {
      const dashboard = await dashboardData(runtime, projectContext);
      return commandResult("dashboard", dashboard.data, {
        meta: { ...meta, ...dashboard.meta },
        sidecars: dashboard.sidecars,
        presentation: { type: "key_value" }
      });
    }
    case "login":
      return commandResult("login", await loginCommand(execution.rest, execution.flags, runtime), { meta });
    case "logout": {
      const profile = await logout();
      return commandResult("logout", { profile, status: profile ? "logged_out" : "no_active_profile" }, { meta });
    }
    case "whoami":
      return commandResult("whoami", await whoamiData(runtime), { meta, presentation: { type: "key_value" } });
    case "status":
      return commandResult("status", await statusCommand(runtime), { meta, presentation: { type: "key_value" } });
    case "version":
      return commandResult("version", versionData(), { meta, presentation: { type: "key_value" } });
    case "update":
      return commandResult("update", await updateData(), { meta, presentation: { type: "key_value" } });
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
      return redoCommand(execution.rest, runtime, projectContext, meta);
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
      if (ENTITY_COMMANDS[execution.commandName]) {
        return entityListCommand(execution, runtime, meta);
      }
      if (execution.commandName.startsWith("mcp ")) {
        return commandResult(execution.commandName, await executeMcp(execution, runtime), { meta });
      }
      throw new CliError(`No handler for ${execution.commandName}`, { code: "handler_missing", exitCodeName: "internal" });
  }
}

export async function explainResult(execution: CommandExecution, runtime: RuntimeOptions, projectContext: ProjectContext) {
  const data: Record<string, unknown> = {
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
  };

  if (execution.commandName === "mcp tools call" && execution.rest[0]) {
    data.wrapped_tool_safety = await wrappedToolSafety(runtime, execution.rest[0]);
  }

  return commandResult("explain", data, {
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

async function statusCommand(runtime: RuntimeOptions): Promise<Record<string, unknown>> {
  return await callMcpResult(runtime, "nitro_get_status", {});
}

async function entityListCommand(
  execution: CommandExecution,
  runtime: RuntimeOptions,
  meta: CommandMeta
): Promise<CommandResult> {
  const config = ENTITY_COMMANDS[execution.commandName];
  const page = integerFlag(execution.flags, "page");
  const per = integerFlag(execution.flags, "per") ?? integerFlag(execution.flags, "limit");
  const filters: Record<string, unknown> = {};
  const search = flagString(execution.flags, "search") || flagString(execution.flags, "query");
  const status = flagString(execution.flags, "status");
  const listId = integerFlag(execution.flags, "list-id");

  if (search && config.searchFilter) filters[config.searchFilter] = search;
  if (status && config.statusFilter) filters.status = status;
  if (listId !== undefined && config.entity === "contacts") filters.list_id = listId;

  const result = await callMcpResult(runtime, "nitro_query", {
    entity: config.entity,
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(per !== undefined ? { per } : {})
  });

  const rows = Array.isArray(result.items) ? result.items as Array<Record<string, unknown>> : [];
  return commandResult(execution.commandName, {
    title: config.title,
    rows,
    pagination: result.pagination
  }, {
    meta,
    presentation: {
      type: "table",
      columns: tableColumnsFor(config.entity, rows)
    }
  });
}

function versionData(): Record<string, unknown> {
  return {
    package: "@nitrosend/cli",
    version: CURRENT_VERSION,
    node: process.version,
    update_command: "npm install -g @nitrosend/cli@latest"
  };
}

async function updateData(): Promise<Record<string, unknown>> {
  const latestVersion = await latestPublishedVersion();
  const comparison = latestVersion ? compareSemver(CURRENT_VERSION, latestVersion) : null;
  const updateCommand = "npm install -g @nitrosend/cli@latest";

  if (comparison === 0) {
    return {
      status: "up_to_date",
      package: "@nitrosend/cli",
      current_version: CURRENT_VERSION,
      latest_version: latestVersion
    };
  }

  if (comparison !== null && comparison < 0) {
    return {
      status: "update_available",
      package: "@nitrosend/cli",
      current_version: CURRENT_VERSION,
      latest_version: latestVersion,
      command: updateCommand,
      next_action: "Run the update command, then check `nitrosend --version`."
    };
  }

  return {
    status: "unknown",
    package: "@nitrosend/cli",
    current_version: CURRENT_VERSION,
    latest_version: latestVersion,
    command: updateCommand,
    next_action: "Could not confirm the latest registry version. Run the update command if you want to reinstall latest."
  };
}

interface DashboardPayload {
  data: Record<string, unknown>;
  sidecars: CommandSidecars;
  meta?: CommandMeta;
}

async function dashboardData(runtime: RuntimeOptions, projectContext: ProjectContext): Promise<DashboardPayload> {
  let authState: Record<string, unknown>;
  try {
    authState = await whoamiData(runtime);
  } catch {
    authState = { source: "none", next_action: "Run `nitrosend login` or set NITROSEND_API_KEY." };
    return minimalDashboard(projectContext, authState);
  }

  const cacheKey = dashboardCacheKey(authState, projectContext);
  const cached = await readCache<Record<string, unknown>>(cacheKey);
  if (cached && !cached.stale) {
    return dashboardFromStatus(projectContext, authState, cached.value, {
      source: "cache",
      meta: { cached: true }
    });
  }

  try {
    const auth = await resolveAuth(runtime.profile);
    const client = new McpClient({ auth });
    const result = await client.callTool("nitro_get_status", {});
    const interpreted = interpretToolResult(result);
    if (!interpreted.ok) {
      throw new CliError(interpreted.error.message, {
        code: interpreted.error.code,
        exitCodeName: interpreted.error.exitCodeName,
        retriable: interpreted.error.retriable
      });
    }

    const parsed = parseToolJson<{ result?: Record<string, unknown> }>(interpreted.value);
    const status = parsed?.result && typeof parsed.result === "object" ? parsed.result : parsed as Record<string, unknown> | null;
    if (!status) throw new CliError("nitro_get_status did not return JSON status", { code: "invalid_status", exitCodeName: "data" });

    await writeCache(cacheKey, status, 300);
    return dashboardFromStatus(projectContext, authState, status, { source: "live" });
  } catch (error) {
    if (cached) {
      return dashboardFromStatus(projectContext, authState, cached.value, {
        source: "stale",
        meta: { cached: true, stale: true },
        warning: error instanceof Error ? error.message : String(error)
      });
    }
    return minimalDashboard(projectContext, authState, error instanceof Error ? error.message : String(error));
  }
}

function dashboardFromStatus(
  projectContext: ProjectContext,
  authState: Record<string, unknown>,
  status: Record<string, unknown>,
  options: { source: "live" | "cache" | "stale"; meta?: CommandMeta; warning?: string }
): DashboardPayload {
  const account = recordValue(status.account);
  const onboarding = recordValue(status.onboarding);
  const provider = recordValue(status.provider);
  const billing = recordValue(status.billing);
  const firstSendComplete = completed(onboarding.first_send);
  const blockers: string[] = [];

  if (firstSendComplete === false) blockers.push("first_send is not completed");
  if (account.using_sandbox === true) blockers.push("Sandbox sender is active");
  if (provider.configured === false) blockers.push("Email provider is not fully configured");

  return {
    data: {
      profile: authState.profile || projectContext.profile || "default",
      environment: dashboardEnvironment(projectContext),
      project_config: projectContext.path || null,
      status_source: options.source,
      auth: authState,
      account: pick(account, ["tier", "can_send", "contact_count", "flow_count", "campaign_count", "using_sandbox"]),
      onboarding: {
        brand_setup: completed(onboarding.brand_setup),
        domain_verified: completed(onboarding.domain_verified),
        first_contact: completed(onboarding.first_contact),
        first_send: firstSendComplete
      },
      provider: pick(provider, ["name", "configured", "domain_verified"]),
      billing: pick(billing, ["plan", "tier", "wallet_balance_cents", "resources"])
    },
    meta: options.meta,
    sidecars: {
      blockers,
      warnings: options.warning ? [`Using ${options.source} dashboard data: ${options.warning}`] : undefined,
      next_action: nextDashboardAction(blockers),
      suggested_tool_calls: [{ name: "nitro_get_status", arguments: {} }]
    }
  };
}

function minimalDashboard(projectContext: ProjectContext, authState: Record<string, unknown>, warning?: string): DashboardPayload {
  const unauthenticated = authState.source === "none";
  return {
    data: {
      profile: authState.profile || projectContext.profile || "default",
      environment: dashboardEnvironment(projectContext),
      project_config: projectContext.path || null,
      status_source: "local",
      auth: pick(authState, ["source", "profile", "apiUrl"])
    },
    sidecars: {
      blockers: unauthenticated ? ["No active credentials"] : [],
      warnings: warning ? [warning] : undefined,
      next_action: unauthenticated
        ? "Run `nitrosend login --api-key ...` or set NITROSEND_API_KEY."
        : "Run `nitrosend status --json`."
    }
  };
}

function dashboardCacheKey(authState: Record<string, unknown>, projectContext: ProjectContext): string {
  const profile = String(authState.profile || projectContext.profile || authState.source || "default");
  const apiUrl = String(authState.apiUrl || "default");
  return `dashboard_${profile}_${apiUrl.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function nextDashboardAction(blockers: string[]): string {
  if (blockers.some((blocker) => blocker.includes("first_send"))) {
    return "Run `nitrosend status` and complete the first-send setup.";
  }
  if (blockers.length > 0) return "Run `nitrosend status --json` for setup details.";
  return "Run `nitrosend flows list` or `nitrosend contacts list`.";
}

function dashboardEnvironment(projectContext: ProjectContext): string | undefined {
  return projectContext.environment === "development" ? undefined : projectContext.environment;
}

function describeCommand(rest: string[]): CommandDescriptor | Record<string, unknown> {
  const name = rest.join(" ").trim();
  const descriptor = findDescriptor(name);
  if (descriptor) return descriptor;

  const commands = COMMAND_DESCRIPTORS
    .filter((candidate) => candidate.name === name || candidate.name.startsWith(`${name} `))
    .map((candidate) => ({
      name: candidate.name,
      summary: candidate.summary,
      usage: candidate.usage
    }));

  if (commands.length > 0) {
    return {
      name,
      type: "command_group",
      commands,
      next_action: `Run \`nitrosend describe ${commands[0].name}\` for a specific command.`
    };
  }

  throw unknownCommand(name || "describe");
}

function completionCommand(rest: string[]): string {
  const shell = rest[0];
  const tree = completionTree(commandNames());
  if (shell === "bash") return bashCompletion(tree);
  if (shell === "zsh") return zshCompletion(tree);
  if (shell === "fish") return fishCompletion(tree);
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

async function redoCommand(
  rest: string[],
  runtime: RuntimeOptions,
  projectContext: ProjectContext,
  meta: CommandMeta
): Promise<CommandResult> {
  const index = Number(rest[0] || "1") - 1;
  const entries = await readHistory();
  const entry = entries[index];
  if (!entry) {
    throw new CliError("No recent command at that index", {
      code: "history_not_found",
      exitCodeName: "data"
    });
  }

  const replay = replayExecutionFor(entry.command);
  if (!replay.allowed) {
    return commandResult("redo", {
      selected: index + 1,
      command: entry.command,
      replayed: false,
      status: "refused",
      reason: replay.reason,
      next_action: "Rerun the command manually after review."
    }, { meta });
  }

  const result = await executeCommand(replay.execution, runtimeForReplay(runtime, replay.execution), projectContext);
  return commandResult("redo", {
    selected: index + 1,
    command: entry.command,
    replayed: true,
    result
  }, { meta });
}

function replayExecutionFor(command: string):
  | { allowed: true; execution: CommandExecution }
  | { allowed: false; reason: string } {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  if (argv[0] === "nitrosend") argv.shift();
  if (argv.length === 0) return { allowed: false, reason: "Empty history entry cannot be replayed" };

  const parsed = parseArgs(argv);
  const resolved = resolveExecution(parsed.positionals);
  const execution: CommandExecution = { ...resolved, flags: parsed.flags };
  if (["redo", "login", "logout", "approve", "reject"].includes(execution.commandName)) {
    return { allowed: false, reason: `${execution.commandName} is not replayable` };
  }

  const safetyClass = execution.commandName === "mcp tools call"
    ? safetyClassFromToolName(execution.rest[0] || "")
    : execution.descriptor.safety.class;

  if (safetyClass !== "read") {
    return { allowed: false, reason: `Refusing to replay ${safetyClass} command` };
  }

  return { allowed: true, execution };
}

function runtimeForReplay(runtime: RuntimeOptions, execution: CommandExecution): RuntimeOptions {
  return {
    ...runtime,
    profile: flagString(execution.flags, "profile") || runtime.profile,
    apiUrl: flagString(execution.flags, "api-url") || runtime.apiUrl,
    dryRun: flagBoolean(execution.flags, "dry-run") || runtime.dryRun
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
    case "mcp tools list": {
      const tools = await client.listTools();
      await writeToolsCache(auth.apiUrl, tools);
      return tools;
    }
    case "mcp tools call":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp tools call <name> --args '{...}'", { code: "usage_error", exitCodeName: "usage" });
      return checkedToolResult(await client.callTool(rest[0], args));
    case "mcp resources list":
      return client.listResources();
    case "mcp resources read":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp resources read <uri>", { code: "usage_error", exitCodeName: "usage" });
      return checkedResourceResult(await client.readResource(rest[0]));
    case "mcp prompts list":
      return client.listPrompts();
    case "mcp prompts get":
      if (!rest[0]) throw new CliError("Usage: nitrosend mcp prompts get <name> --args '{...}'", { code: "usage_error", exitCodeName: "usage" });
      return client.getPrompt(rest[0], args);
    default:
      throw unknownCommand(execution.commandName);
  }
}

async function callMcpResult(
  runtime: RuntimeOptions,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const auth = await resolveAuth(runtime.profile);
  const client = new McpClient({ auth });
  const result = checkedToolResult(await client.callTool(name, args));
  const parsed = parseToolJson<{ result?: unknown }>(result);
  const payload = parsed && "result" in parsed ? parsed.result : parsed;
  if (!recordLike(payload)) {
    throw new CliError(`${name} did not return an object result`, {
      code: "invalid_tool_result",
      exitCodeName: "data"
    });
  }
  return payload as Record<string, unknown>;
}

async function wrappedToolSafety(runtime: RuntimeOptions, name: string): Promise<Record<string, unknown>> {
  const auth = await resolveAuth(runtime.profile).catch(() => null);
  if (auth) {
    const cached = await readToolsCache(auth.apiUrl);
    const cachedTool = findTool(cached, name);
    if (cachedTool && hasSafetyAnnotations(cachedTool)) {
      return {
        name,
        safety_class: safetyClassFromTool(cachedTool, name),
        source: "tools_list_cache",
        annotations: cachedTool.annotations
      };
    }

    const liveTools = await fetchToolsCache(auth).catch(() => null);
    const liveTool = findTool(liveTools, name);
    if (liveTool && hasSafetyAnnotations(liveTool)) {
      return {
        name,
        safety_class: safetyClassFromTool(liveTool, name),
        source: "tools_list_cache",
        annotations: liveTool.annotations
      };
    }
  }

  return {
    name,
    safety_class: safetyClassFromToolName(name),
    source: "name_pattern"
  };
}

async function fetchToolsCache(auth: Awaited<ReturnType<typeof resolveAuth>>) {
  const client = new McpClient({ auth });
  const tools = await client.listTools();
  await writeToolsCache(auth.apiUrl, tools);
  return tools;
}

async function readToolsCache(apiUrl: string) {
  const cached = await readCache<Awaited<ReturnType<McpClient["listTools"]>>>(toolsCacheKey(apiUrl));
  return cached?.value ?? null;
}

async function writeToolsCache(apiUrl: string, tools: Awaited<ReturnType<McpClient["listTools"]>>): Promise<void> {
  await writeCache(toolsCacheKey(apiUrl), tools, TOOLS_CACHE_TTL_SECONDS);
}

function toolsCacheKey(apiUrl: string): string {
  return `mcp_tools_${apiUrl.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function checkedToolResult(result: Awaited<ReturnType<McpClient["callTool"]>>) {
  const interpreted = interpretToolResult(result);
  if (interpreted.ok) return interpreted.value;
  throw new CliError(interpreted.error.message, {
    code: interpreted.error.code,
    exitCodeName: interpreted.error.exitCodeName,
    retriable: interpreted.error.retriable
  });
}

function checkedResourceResult(result: Awaited<ReturnType<McpClient["readResource"]>>) {
  const interpreted = interpretResourceResult(result);
  if (interpreted.ok) return interpreted.value;
  throw new CliError(interpreted.error.message, {
    code: interpreted.error.code,
    exitCodeName: interpreted.error.exitCodeName,
    retriable: interpreted.error.retriable
  });
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

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function completed(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const record = recordValue(value);
  if (typeof record.completed === "boolean") return record.completed;
  return null;
}

function pick(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, record[key]]).filter(([, value]) => value !== undefined));
}

function integerFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new CliError(`--${name} must be a positive integer`, {
      code: "invalid_integer_flag",
      exitCodeName: "data"
    });
  }
  return parsed;
}

function tableColumnsFor(entity: string, rows: Array<Record<string, unknown>>) {
  const preferred: Record<string, string[]> = {
    flows: ["id", "name", "status", "approval_state", "trigger_event", "step_count"],
    campaigns: ["id", "name", "status", "sent_count", "created_at"],
    contacts: ["id", "email", "first_name", "last_name", "subscribed_email"],
    lists: ["id", "name", "contact_count", "created_at"],
    templates: ["id", "name", "subject", "created_at"]
  };
  const keys = preferred[entity] || Object.keys(rows[0] || {}).slice(0, 6);
  return keys.map((key) => ({ key, label: humanLabel(key) }));
}

function humanLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (match) => match.toUpperCase());
}

function recordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CompletionTree {
  topLevel: string[];
  byPrefix: Record<string, string[]>;
}

function completionTree(names: string[]): CompletionTree {
  const topLevel = new Set<string>();
  const byPrefix: Record<string, Set<string>> = {};
  for (const name of names) {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length === 0) continue;
    topLevel.add(parts[0]);
    for (let index = 1; index < parts.length; index++) {
      const prefix = parts.slice(0, index).join(" ");
      byPrefix[prefix] ??= new Set<string>();
      byPrefix[prefix].add(parts[index]);
    }
  }
  return {
    topLevel: [...topLevel].sort(),
    byPrefix: Object.fromEntries(Object.entries(byPrefix).map(([key, values]) => [key, [...values].sort()]))
  };
}

function bashCompletion(tree: CompletionTree): string {
  const cases = Object.entries(tree.byPrefix)
    .map(([prefix, words]) => {
      const parts = prefix.split(" ");
      const condition = parts.map((part, index) => `\${COMP_WORDS[${index + 1}]} = ${shellQuote(part)}`).join(" && ");
      return `      if [[ ${condition} ]]; then COMPREPLY=( $(compgen -W ${shellQuote(words.join(" "))} -- "$cur") ); return; fi`;
    })
    .join("\n");

  return `_nitrosend_completion() {
  local cur
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W ${shellQuote(tree.topLevel.join(" "))} -- "$cur") )
    return
  fi
${cases}
}
complete -F _nitrosend_completion nitrosend
`;
}

function zshCompletion(tree: CompletionTree): string {
  const top = tree.topLevel.join(" ");
  const specs = [
    `'1:command:(${top})'`,
    ...Object.entries(tree.byPrefix).map(([prefix, words]) => {
      const depth = prefix.split(" ").length + 1;
      return `'${depth}:${prefix}:(${words.join(" ")})'`;
    })
  ];
  return `#compdef nitrosend
_arguments \\
  ${specs.join(" \\\n  ")}
`;
}

function fishCompletion(tree: CompletionTree): string {
  const lines = [
    `complete -c nitrosend -f -n '__fish_use_subcommand' -a '${tree.topLevel.join(" ")}'`
  ];
  for (const [prefix, words] of Object.entries(tree.byPrefix)) {
    lines.push(`complete -c nitrosend -f -n '__fish_seen_subcommand_from ${prefix}' -a '${words.join(" ")}'`);
  }
  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function latestPublishedVersion(): Promise<string | null> {
  try {
    const response = await fetch("https://registry.npmjs.org/@nitrosend%2fcli/latest", {
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return null;
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}
