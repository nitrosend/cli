import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configDir = mkdtempSync(join(tmpdir(), "nitrosend-dashboard-"));
try {
  const result = spawnSync(process.execPath, ["dist/index.js", "--json"], {
    encoding: "utf8",
    env: { ...process.env, NITROSEND_CONFIG_DIR: configDir }
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.command, "dashboard");
  assert.ok(Array.isArray(parsed.data.suggested_actions));
  console.log("dashboard contract passed");
} finally {
  rmSync(configDir, { recursive: true, force: true });
}
