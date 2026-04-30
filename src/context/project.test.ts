import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProjectContext } from "./project.js";

test("loads .nitrosend.yml by walking from cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-project-"));
  try {
    await writeFile(join(dir, ".nitrosend.yml"), "profile: sandbox\nenvironment: sandbox\noutput: json\n");
    const context = await loadProjectContext(join(dir, "nested"));
    assert.equal(context.profile, "sandbox");
    assert.equal(context.environment, "sandbox");
    assert.equal(context.color, "green");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects secrets in project config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-project-"));
  try {
    await writeFile(join(dir, ".nitrosend.yml"), "api_key: nskey_test_placeholder\n");
    await assert.rejects(() => loadProjectContext(dir), /must not contain secrets/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
