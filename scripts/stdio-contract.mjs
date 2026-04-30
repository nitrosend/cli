import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["dist/index.js", "definitely-unknown", "--json"], {
  encoding: "utf8"
});

assert.notEqual(result.status, 0);
assert.equal(result.stderr, "");
const parsed = JSON.parse(result.stdout);
assert.equal(parsed.schema_version, 1);
assert.equal(parsed.ok, false);
assert.equal(parsed.error.code, "unknown_command");
console.log("stdio contract passed");
