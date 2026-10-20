import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./cli.js";

test("send maps its flags to nitro_send_message with an idempotency key", async () => {
  const result = await run(
    ["send", "--to", "you@example.test", "--subject", "Hello", "--body", "First send.", "--json"],
    [{ id: 41, status: "queued" }]
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.id, 41);
  const call = result.calls[0];
  assert.equal(call.name, "nitro_send_message");
  assert.equal(call.arguments.channel, "email");
  assert.equal(call.arguments.to, "you@example.test");
  assert.equal(call.arguments.subject, "Hello");
  assert.equal(call.arguments.body, "First send.");
  assert.equal(call.arguments.dry_run, false);
  assert.match(String(call.arguments.idempotency_key), /^cli-/);
});

test("send passes --dry-run and a given idempotency key through", async () => {
  const result = await run(
    ["send", "--to", "you@example.test", "--subject", "Hi", "--body", "x", "--dry-run", "--idempotency-key", "first-send-1", "--json"],
    [{ dry_run: true }]
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.calls[0].arguments.dry_run, true);
  assert.equal(result.calls[0].arguments.idempotency_key, "first-send-1");
});

test("send refuses an email with no content before calling the server", async () => {
  const result = await run(["send", "--to", "you@example.test", "--json"], []);

  assert.notEqual(result.code, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "missing_email_content");
  assert.equal(result.calls.length, 0);
});

test("output: in .nitrosend.yml sets the output mode when no flag does", async () => {
  const result = await run(
    ["send", "--to", "you@example.test", "--subject", "Hi", "--body", "x"],
    [{ id: 8 }],
    { projectConfig: "output: json\n" }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.id, 8);
});

test("profile: in .nitrosend.yml selects that profile", async () => {
  const result = await run(
    ["send", "--to", "you@example.test", "--subject", "Hi", "--body", "x", "--json"],
    [{ id: 7 }],
    { projectConfig: "profile: work\n" }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.authorization, "Bearer nskey_test_work");
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  authorization?: string;
}

async function run(argv: string[], results: Array<Record<string, unknown>>, options: { projectConfig?: string } = {}): Promise<Run> {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-send-"));
  const project = join(dir, "project");
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousKey = process.env.NITROSEND_API_KEY;
  const previousFetch = globalThis.fetch;
  const calls: Run["calls"] = [];
  let authorization: string | undefined;
  let responseIndex = 0;
  let stdout = "";
  let stderr = "";

  process.env.NITROSEND_CONFIG_DIR = dir;
  delete process.env.NITROSEND_API_KEY;
  await mkdir(project, { recursive: true });
  if (options.projectConfig) await writeFile(join(project, ".nitrosend.yml"), options.projectConfig);
  const profile = (name: string) => ({ name, apiUrl: "https://api.example.test/mcp", token: `nskey_test_${name}`, tokenType: "api_key" });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: { default: profile("default"), work: profile("work") }
  }));

  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? undefined;
    const params = (JSON.parse(String(init?.body)) as { params: { name: string; arguments: Record<string, unknown> } }).params;
    calls.push({ name: params.name, arguments: params.arguments });
    const result = results[responseIndex++];
    if (!result) throw new Error("Unexpected MCP request");
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify({ result }) }] }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const code = await runCli({
      argv,
      cwd: project,
      stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
      stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
    });
    return { code, stdout, stderr, calls, authorization };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    if (previousKey !== undefined) process.env.NITROSEND_API_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  }
}
