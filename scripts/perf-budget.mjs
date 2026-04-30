import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const budgetMs = Number(process.env.NITROSEND_CLI_PERF_BUDGET_MS || 250);

for (const args of [["--help"], ["--version"]]) {
  const start = performance.now();
  const result = spawnSync(process.execPath, ["dist/index.js", ...args], { encoding: "utf8" });
  const duration = performance.now() - start;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(duration < budgetMs, `${args.join(" ")} took ${duration.toFixed(1)}ms, budget ${budgetMs}ms`);
}

console.log(`perf budget passed (${budgetMs}ms)`);
