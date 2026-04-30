import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CliError } from "./errors.js";

export interface Profile {
  name: string;
  apiUrl: string;
  token: string;
  tokenType: "api_key" | "bearer";
  refreshToken?: string;
  expiresAt?: string;
  accountLabel?: string;
}

export interface ConfigFile {
  currentProfile: string;
  profiles: Record<string, Profile>;
}

const DEFAULT_PROFILE = "default";
const DEFAULT_API_URL = "https://api.nitrosend.com/mcp";

export function defaultApiUrl(): string {
  return process.env.NITROSEND_API_URL || DEFAULT_API_URL;
}

export function configPath(): string {
  if (process.env.NITROSEND_CONFIG_DIR) {
    return join(process.env.NITROSEND_CONFIG_DIR, "profiles.json");
  }

  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "nitrosend", "profiles.json");
}

export async function loadConfig(path = configPath()): Promise<ConfigFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as ConfigFile;
    return {
      currentProfile: parsed.currentProfile || DEFAULT_PROFILE,
      profiles: parsed.profiles || {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { currentProfile: DEFAULT_PROFILE, profiles: {} };
    }
    throw new CliError(`Could not read Nitrosend config at ${path}: ${(error as Error).message}`);
  }
}

export async function saveConfig(config: ConfigFile, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, path);
}

export async function storeProfile(profile: Profile, path = configPath()): Promise<void> {
  const config = await loadConfig(path);
  config.currentProfile = profile.name;
  config.profiles[profile.name] = profile;
  await saveConfig(config, path);
}

export async function deleteCurrentProfile(path = configPath()): Promise<string | null> {
  const config = await loadConfig(path);
  const name = config.currentProfile || DEFAULT_PROFILE;
  if (!config.profiles[name]) return null;
  delete config.profiles[name];
  config.currentProfile = Object.keys(config.profiles)[0] || DEFAULT_PROFILE;
  await saveConfig(config, path);
  return name;
}

export async function currentProfile(path = configPath()): Promise<Profile | null> {
  const config = await loadConfig(path);
  return config.profiles[config.currentProfile] ?? null;
}

export async function configExists(path = configPath()): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
