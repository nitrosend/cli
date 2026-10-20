import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABELS = {
  all: [""],
  approval: ["cli.test.js"],
  auth: ["auth.test.js", "cli.test.js"],
  cache: ["cache/", "context/project.test.js"],
  commands: ["cli.test.js", "commands/"],
  completion: ["cli.test.js"],
  confirm: ["safety/"],
  contracts: ["contracts/", "cli.test.js", "output.test.js"],
  dashboard: ["cli.test.js", "contracts/schema-validator.test.js"],
  describe: ["cli.test.js"],
  "did-you-mean": ["cli.test.js"],
  "dry-run": ["safety/", "cli.test.js"],
  "environment-guards": ["safety/", "context/project.test.js"],
  errors: ["output.test.js", "cli.test.js", "contracts/schema-validator.test.js"],
  explain: ["cli.test.js"],
  golden: ["contracts/schema-validator.test.js"],
  idempotency: ["cli.test.js"],
  machine: ["cli.test.js"],
  mcp: ["mcp/", "cli.test.js"],
  "project-context": ["context/project.test.js"],
  recent: ["cli.test.js"],
  redo: ["cli.test.js"],
  renderers: ["output.test.js"],
  safety: ["safety/", "cli.test.js"],
  schema: ["contracts/schema-validator.test.js"],
  "stream-events": ["contracts/schema-validator.test.js"],
  trace: ["cli.test.js"],
  upgrades: ["version/gate.test.js"]
};

const allFiles = await listTests(fileURLToPath(new URL("../dist", import.meta.url)));
const files = selectTests(allFiles, process.argv.slice(2));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);

function selectTests(files, labels) {
  const sorted = files.sort();
  if (labels.length === 0) return sorted;

  const selected = new Set();
  for (const label of labels) {
    const patterns = LABELS[label];
    if (!patterns) continue;
    for (const pattern of patterns) {
      for (const file of sorted) {
        if (file.includes(pattern)) selected.add(file);
      }
    }
  }

  return selected.size > 0 ? [...selected].sort() : sorted;
}

async function listTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listTests(path));
    if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(path);
  }
  return files;
}
