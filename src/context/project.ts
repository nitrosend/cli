import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { OutputMode } from "../contracts/types.js";
import { CliError } from "../errors.js";

export interface ProjectContext {
  path?: string;
  profile?: string;
  output?: OutputMode;
  // A local label the project sets in .nitrosend.yml; absent unless it does.
  environment?: Environment;
  color: "red" | "yellow" | "green" | "blue";
  apiUrl?: string;
}

type Environment = "production" | "staging" | "sandbox" | "development";

const ENV_COLORS: Record<Environment, ProjectContext["color"]> = {
  production: "red",
  staging: "yellow",
  sandbox: "green",
  development: "blue"
};

export async function loadProjectContext(cwd = process.cwd()): Promise<ProjectContext> {
  const path = await findProjectConfig(cwd);
  if (!path) return defaultProjectContext();

  const raw = await readFile(path, "utf8");
  const parsed = parseSimpleYaml(raw, path);
  const environment = environmentValue(parsed.environment);
  return {
    path,
    profile: parsed.profile,
    output: outputValue(parsed.output),
    environment,
    color: colorValue(parsed.color) ?? (environment ? ENV_COLORS[environment] : "blue"),
    apiUrl: parsed.api_url || parsed.apiUrl
  };
}

export function defaultProjectContext(): ProjectContext {
  return { color: "blue" };
}

async function findProjectConfig(start: string): Promise<string | null> {
  let dir = start;
  while (true) {
    const candidate = join(dir, ".nitrosend.yml");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir || parse(dir).root === dir) return null;
      dir = parent;
    }
  }
}

function parseSimpleYaml(raw: string, path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      throw new CliError(`Invalid .nitrosend.yml line ${index + 1}`, {
        code: "invalid_project_config",
        exitCodeName: "data"
      });
    }

    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, "");
    if (/(secret|token|password|api[_-]?key)/i.test(key)) {
      throw new CliError(`Project config ${path} must not contain secrets (${key})`, {
        code: "project_config_secret",
        exitCodeName: "data"
      });
    }
    values[key] = value;
  }
  return values;
}

function environmentValue(value: string | undefined): Environment | undefined {
  if (value === "production" || value === "staging" || value === "sandbox" || value === "development") {
    return value;
  }
  return undefined;
}

function outputValue(value: string | undefined): OutputMode | undefined {
  if (value === "tty" || value === "json" || value === "ndjson" || value === "csv") return value;
  return undefined;
}

function colorValue(value: string | undefined): ProjectContext["color"] | undefined {
  if (value === "red" || value === "yellow" || value === "green" || value === "blue") return value;
  return undefined;
}
