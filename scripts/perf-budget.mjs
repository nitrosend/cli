import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const budgetMs = Number(process.env.NITROSEND_CLI_PERF_BUDGET_MS || 250);
const overheadBudgetMs = Number(process.env.NITROSEND_CLI_PERF_OVERHEAD_BUDGET_MS || 75);

const baselineStart = performance.now();
const baseline = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
const baselineMs = performance.now() - baselineStart;
assert.equal(baseline.status, 0, baseline.stderr);
const effectiveBudgetMs = Math.max(budgetMs, baselineMs + overheadBudgetMs);

for (const args of [["--help"], ["--version"]]) {
  const start = performance.now();
  const result = spawnSync(process.execPath, ["dist/index.js", ...args], { encoding: "utf8" });
  const duration = performance.now() - start;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    duration < effectiveBudgetMs,
    `${args.join(" ")} took ${duration.toFixed(1)}ms; runtime baseline ${baselineMs.toFixed(1)}ms, ` +
      `absolute budget ${budgetMs}ms, overhead budget ${overheadBudgetMs}ms`,
  );
}

console.log(
  `perf budget passed (baseline ${baselineMs.toFixed(1)}ms, ` +
    `absolute ${budgetMs}ms, overhead ${overheadBudgetMs}ms)`,
);
