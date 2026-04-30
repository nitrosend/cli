import { parseArgs, flagBoolean, flagString } from "./args.js";
import { loginWithApiKey, loginWithOAuth, logout, resolveAuth } from "./auth.js";
import { currentProfile, defaultApiUrl } from "./config.js";
import { CliError, isCliError } from "./errors.js";
import { McpClient } from "./mcp/client.js";
import { printHuman, printJson } from "./output.js";
import { redact } from "./redact.js";
import { CURRENT_VERSION } from "./version/current.js";

export interface RunOptions {
  argv: string[];
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function runCli(options: RunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const parsed = parseArgs(options.argv);
    const [command, ...rest] = parsed.positionals;

    if (!command || flagBoolean(parsed.flags, "help")) {
      stdout.write(helpText());
      return 0;
    }

    if (flagBoolean(parsed.flags, "version") || command === "version") {
      stdout.write(`${CURRENT_VERSION}\n`);
      return 0;
    }

    switch (command) {
      case "login":
        return await handleLogin(rest, parsed.flags, stdout, stderr);
      case "logout":
        return await handleLogout(stdout);
      case "whoami":
        return await handleWhoami(stdout);
      case "mcp":
        return await handleMcp(rest, parsed.flags, stdout);
      default:
        throw new CliError(`Unknown command: ${command}\n\n${shortHelpText()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${redact(message)}\n`);
    return isCliError(error) ? error.exitCode : 1;
  }
}

async function handleLogin(
  rest: string[],
  inheritedFlags: Record<string, string | boolean>,
  stdout: Pick<NodeJS.WriteStream, "write">,
  stderr: Pick<NodeJS.WriteStream, "write">
): Promise<number> {
  const parsed = parseArgs(rest);
  const flags = { ...inheritedFlags, ...parsed.flags };
  const profile = flagString(flags, "profile") || "default";
  const apiUrl = flagString(flags, "api-url") || defaultApiUrl();
  const apiKey = flagString(flags, "api-key");

  if (apiKey) {
    await loginWithApiKey(apiKey, { profile, apiUrl });
    stdout.write(`Logged in with API key profile ${profile}\n`);
    return 0;
  }

  stderr.write("Opening browser for Nitrosend OAuth login...\n");
  const saved = await loginWithOAuth({
    profile,
    apiUrl,
    openBrowser: !flagBoolean(flags, "no-browser")
  });
  stdout.write(`Logged in with OAuth profile ${saved.name}\n`);
  return 0;
}

async function handleLogout(stdout: Pick<NodeJS.WriteStream, "write">): Promise<number> {
  const name = await logout();
  stdout.write(name ? `Logged out profile ${name}\n` : "No active profile\n");
  return 0;
}

async function handleWhoami(stdout: Pick<NodeJS.WriteStream, "write">): Promise<number> {
  const auth = await resolveAuth();
  const profile = auth.source === "profile" ? await currentProfile() : null;
  printHuman(stdout, {
    auth: auth.tokenType,
    source: auth.source,
    profile: auth.profileName,
    apiUrl: auth.apiUrl,
    expiresAt: profile?.expiresAt
  });
  return 0;
}

async function handleMcp(
  rest: string[],
  inheritedFlags: Record<string, string | boolean>,
  stdout: Pick<NodeJS.WriteStream, "write">
): Promise<number> {
  const parsed = parseArgs(rest);
  const flags = { ...inheritedFlags, ...parsed.flags };
  const [resource, action, nameOrUri] = parsed.positionals;
  const auth = await resolveAuth(flagString(flags, "profile"));
  const client = new McpClient({ auth });
  const args = parseJsonObject(flagString(flags, "args") || flagString(flags, "json-args") || "{}");
  const json = flagBoolean(flags, "json");

  let result: unknown;
  if (resource === "initialize" || !resource) {
    result = await client.initialize();
  } else if (resource === "tools" && action === "list") {
    result = await client.listTools();
  } else if (resource === "tools" && action === "call") {
    if (!nameOrUri) throw new CliError("Usage: nitrosend mcp tools call <name> --args '{...}'");
    result = await client.callTool(nameOrUri, args);
  } else if (resource === "resources" && action === "list") {
    result = await client.listResources();
  } else if (resource === "resources" && action === "read") {
    if (!nameOrUri) throw new CliError("Usage: nitrosend mcp resources read <uri>");
    result = await client.readResource(nameOrUri);
  } else if (resource === "prompts" && action === "list") {
    result = await client.listPrompts();
  } else if (resource === "prompts" && action === "get") {
    if (!nameOrUri) throw new CliError("Usage: nitrosend mcp prompts get <name> --args '{...}'");
    result = await client.getPrompt(nameOrUri, args);
  } else {
    throw new CliError(`Unknown MCP command.\n\n${mcpHelpText()}`);
  }

  json ? printJson(stdout, result) : printHuman(stdout, result);
  return 0;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new CliError(`Invalid JSON args: ${(error as Error).message}`);
  }
  throw new CliError("JSON args must be an object");
}

function helpText(): string {
  return `${shortHelpText()}

Commands:
  nitrosend login [--api-key <key>] [--api-url <url>] [--profile <name>]
  nitrosend logout
  nitrosend whoami
  nitrosend mcp initialize [--json]
  nitrosend mcp tools list [--json]
  nitrosend mcp tools call <name> --args '{...}' [--json]
  nitrosend mcp resources list [--json]
  nitrosend mcp resources read <uri> [--json]
  nitrosend mcp prompts list [--json]
  nitrosend mcp prompts get <name> --args '{...}' [--json]
`;
}

function shortHelpText(): string {
  return `Nitrosend CLI ${CURRENT_VERSION}

Usage:
  nitrosend <command> [options]
`;
}

function mcpHelpText(): string {
  return `MCP commands:
  nitrosend mcp initialize
  nitrosend mcp tools list
  nitrosend mcp tools call <name> --args '{...}'
  nitrosend mcp resources list
  nitrosend mcp resources read <uri>
  nitrosend mcp prompts list
  nitrosend mcp prompts get <name> --args '{...}'
`;
}
