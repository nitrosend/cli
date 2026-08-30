import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";
import { redact } from "./redact.js";

export interface HistoryEntry {
  timestamp: string;
  command: string;
}

const HISTORY_LIMIT = 50;
const PRIVATE_VALUE_FLAGS = new Set(["--api-key", "--args", "--json-args", "--body", "--html"]);

export async function recordHistory(argv: string[]): Promise<void> {
  if (argv.length === 0 || ["recent", "redo", "login"].includes(argv[0])) return;
  const entries = await readHistory();
  entries.unshift({
    timestamp: new Date().toISOString(),
    command: redact(`nitrosend ${privateValuesRedacted(argv).join(" ")}`)
  });
  await writeHistory(entries.slice(0, HISTORY_LIMIT));
}

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await readFile(historyPath(), "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

async function writeHistory(entries: HistoryEntry[]): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(historyPath(), `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
}

function historyPath(): string {
  return join(configDir(), "history.json");
}

function privateValuesRedacted(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const inlineFlag = [...PRIVATE_VALUE_FLAGS].find((flag) => arg.startsWith(`${flag}=`));
    if (inlineFlag) {
      result.push(`${inlineFlag}=[redacted]`);
      continue;
    }

    result.push(arg);
    if (PRIVATE_VALUE_FLAGS.has(arg) && index + 1 < argv.length) {
      result.push("[redacted]");
      index++;
    }
  }
  return result;
}
