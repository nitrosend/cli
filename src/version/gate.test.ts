import assert from "node:assert/strict";
import test from "node:test";
import { CliVersionError, VersionGate } from "./gate.js";

class TestHeaders {
  constructor(private readonly values: Record<string, string>) {}

  get(name: string): string | null {
    return this.values[name.toLowerCase()] ?? this.values[name] ?? null;
  }
}

test("warns once when current version is behind latest", () => {
  let stderr = "";
  const gate = new VersionGate({
    currentVersion: "0.1.0",
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
  });
  const headers = new TestHeaders({ "x-nitrosend-cli-latest": "0.2.0" });

  gate.check(headers);
  gate.check(headers);

  assert.match(stderr, /0\.1\.0 -> 0\.2\.0/);
  assert.equal(stderr.trim().split("\n").length, 1);
});

test("throws when current version is below minimum", () => {
  const gate = new VersionGate({ currentVersion: "0.1.0" });
  const headers = new TestHeaders({ "x-nitrosend-cli-min": "0.2.0" });

  assert.throws(() => gate.check(headers), CliVersionError);
});

test("ignores malformed and missing headers", () => {
  const gate = new VersionGate({ currentVersion: "0.1.0" });
  assert.doesNotThrow(() => gate.check(new TestHeaders({ "x-nitrosend-cli-latest": "later" })));
  assert.doesNotThrow(() => gate.check(new TestHeaders({})));
});
