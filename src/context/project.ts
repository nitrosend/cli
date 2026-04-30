import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { CliError } from "../errors.js";

export interface ProjectContext {
  path?: string;
  profile?: string;
  output?: string;
  environment: "production" | "staging" | "sandbox" | "development";
  color: "red" | "yellow" | "green" | "blue";
  apiUrl?: string;
}

const ENV_COLORS: Record<ProjectContext["environment"], ProjectContext["color"]> = {
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
    output: parsed.output,
    environment,
    color: colorValue(parsed.color) ?? ENV_COLORS[environment],
    apiUrl: parsed.api_url || parsed.apiUrl
  };
}

export function defaultProjectContext(): ProjectContext {
  return {
    environment: "development",
    color: "blue"
  };
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

function environmentValue(value: string | undefined): ProjectContext["environment"] {
  if (value === "production" || value === "staging" || value === "sandbox" || value === "development") {
    return value;
  }
  return "development";
}

function colorValue(value: string | undefined): ProjectContext["color"] | undefined {
  if (value === "red" || value === "yellow" || value === "green" || value === "blue") return value;
  return undefined;
}
