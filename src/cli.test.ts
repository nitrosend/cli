import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./cli.js";

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } },
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

test("unknown commands in json mode use structured stdout and clean stderr", async () => {
  const io = streams();
  const code = await runCli({ argv: ["unknwon", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 64);
  assert.equal(io.stderrText, "");
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "unknown_command");
});

test("describe returns descriptor data", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "mcp", "tools", "list", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.name, "mcp tools list");
  assert.equal(parsed.data.safety.class, "read");
});

test("completion emits raw shell script in tty mode", async () => {
  const io = streams();
  const code = await runCli({ argv: ["completion", "bash"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /^complete -W /);
});

test("machine mode fails closed on typed confirmation", async () => {
  const io = streams();
  const code = await runCli({ argv: ["fixture", "destroy", "demo", "--machine"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 77);
  assert.equal(io.stderrText, "");
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.error.code, "typed_confirmation_required");
});

test("dashboard works without credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-dashboard-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;
  try {
    const io = streams();
    const code = await runCli({ argv: ["--json"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.command, "dashboard");
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
