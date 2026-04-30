import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "../config.js";

export interface CacheEntry<T> {
  expires_at: string;
  value: T;
}

export async function readCache<T>(key: string): Promise<{ value: T; stale: boolean } | null> {
  try {
    const raw = await readFile(cachePath(key), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return {
      value: entry.value,
      stale: Date.parse(entry.expires_at) < Date.now()
    };
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
  const entry: CacheEntry<T> = {
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    value
  };
  await writeFile(cachePath(key), `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
}

function cachePath(key: string): string {
  return join(cacheDir(), `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}
