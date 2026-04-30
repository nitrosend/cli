import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirs = new Set([".git", "node_modules", "coverage"]);
const includeReportsIndex = process.argv.indexOf("--include-reports");
const extraRoots = includeReportsIndex >= 0 ? process.argv.slice(includeReportsIndex + 1) : [];

const patterns = [
  { name: "Nitrosend API key", regex: /nskey_(?:live|test)_[a-f0-9]{20,}/gi },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: "Bearer token assignment", regex: /bearer\s+[A-Za-z0-9._~+/=-]{30,}/gi },
  { name: "Secret assignment", regex: /(password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/gi }
];

const findings = [];

for (const file of await listFiles(root)) {
  await scanFile(file);
}

for (const item of extraRoots) {
  await scanFile(join(process.cwd(), item));
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.name}`);
  }
  process.exit(1);
}

console.log("secret scan passed");

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile() && shouldScan(path)) {
      files.push(path);
    }
  }

  return files;
}

function shouldScan(path) {
  return /\.(?:ts|js|json|md|ya?ml|txt)$/.test(path);
}

async function scanFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }

  const lines = text.split(/\r?\n/);
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (match[0].includes("nskey_test_...") || match[0].includes("nskey_live_...")) continue;
      const line = 1 + text.slice(0, match.index).split(/\r?\n/).length - 1;
      if (lines[line - 1]?.includes("secret-scan")) continue;
      findings.push({ file: relative(root, path), line, name: pattern.name });
    }
  }
}
