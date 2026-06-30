import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./cli.js";
import { CURRENT_VERSION } from "./version/current.js";

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

test("describe group names list available subcommands", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "campaigns", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.type, "command_group");
  assert.equal(parsed.data.commands[0].name, "campaigns list");
});

test("list command examples are runnable commands", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "campaigns", "list", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.examples[0].command, "nitrosend campaigns list --status draft --per 10");
  assert.doesNotMatch(parsed.data.examples[0].command, /\[/);
});

test("login descriptor supports non-interactive api key login", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "login", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.safety.class, "local-state");
  assert.match(parsed.data.summary, /browser OAuth when no API key/);
  assert.match(parsed.data.usage, /--no-browser/);
  assert.equal(parsed.data.examples[1].command, "nitrosend login");
  assert.equal(parsed.data.agent.suitable, true);
  assert.match(parsed.data.agent.reason, /--api-key/);
});

test("logout descriptor is local state only", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "logout", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.safety.class, "local-state");
});

test("mcp tools call descriptor is conservative proxy safety", async () => {
  const io = streams();
  const code = await runCli({ argv: ["describe", "mcp", "tools", "call", "--json"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.data.name, "mcp tools call");
  assert.equal(parsed.data.safety.class, "external-effect");
  assert.match(parsed.data.agent.reason, /Proxy command/);
});

test("explain includes inferred wrapped MCP tool safety", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-explain-fallback-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;
  const io = streams();
  try {
    const code = await runCli({
      argv: ["mcp", "tools", "call", "nitro_control_delivery", "--explain", "--json"],
      stdout: io.stdout,
      stderr: io.stderr
    });

    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.data.wrapped_tool_safety.name, "nitro_control_delivery");
    assert.equal(parsed.data.wrapped_tool_safety.safety_class, "destructive");
    assert.equal(parsed.data.wrapped_tool_safety.source, "name_pattern");
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("explain uses cached MCP tool annotations when credentials exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-explain-cache-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousCache = process.env.NITROSEND_CACHE_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;
  process.env.NITROSEND_CACHE_DIR = join(dir, "cache");

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  globalThis.fetch = async () => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [{
        name: "nitro_control_delivery",
        annotations: { destructiveHint: true, readOnlyHint: false }
      }]
    }
  }), { status: 200 });

  try {
    const io = streams();
    const code = await runCli({
      argv: ["mcp", "tools", "call", "nitro_control_delivery", "--explain", "--json"],
      stdout: io.stdout,
      stderr: io.stderr
    });

    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.data.wrapped_tool_safety.safety_class, "destructive");
    assert.equal(parsed.data.wrapped_tool_safety.source, "tools_list_cache");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    if (previousCache === undefined) delete process.env.NITROSEND_CACHE_DIR;
    else process.env.NITROSEND_CACHE_DIR = previousCache;
    await rm(dir, { recursive: true, force: true });
  }
});

test("completion emits raw shell script in tty mode", async () => {
  const io = streams();
  const code = await runCli({ argv: ["completion", "bash"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  assert.match(io.stdoutText, /complete -F _nitrosend_completion nitrosend/);
  assert.match(io.stdoutText, /COMP_CWORD/);
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
    assert.equal(parsed.data.suggested_actions, undefined);
    assert.deepEqual(parsed.sidecars.blockers, ["No active credentials"]);
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard human output is blocker-aware and does not duplicate sidecars", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-dashboard-human-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;
  try {
    const io = streams();
    const code = await runCli({ argv: ["--no-color"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    assert.match(io.stdoutText, /^Dashboard\n/);
    assert.doesNotMatch(io.stdoutText, /\[development\]/);
    assert.doesNotMatch(io.stdoutText, /^Environment:/m);
    assert.doesNotMatch(io.stdoutText, /Project config:\s*$/m);
    assert.doesNotMatch(io.stdoutText, /nitrosend status/);
    assert.equal((io.stdoutText.match(/^Blockers:/gm) || []).length, 1);
    assert.match(io.stdoutText, /nitrosend login --api-key/);
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("human output renders API URL as a readable label", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-human-label-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  try {
    const io = streams();
    const code = await runCli({ argv: ["whoami", "--no-color"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    assert.match(io.stdoutText, /API URL: https:\/\/api\.example\.test\/mcp/);
    assert.doesNotMatch(io.stdoutText, /ApiUrl:/);
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard uses live MCP status when credentials exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-dashboard-live-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousCache = process.env.NITROSEND_CACHE_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;
  process.env.NITROSEND_CACHE_DIR = join(dir, "cache");

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  globalThis.fetch = async () => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          result: {
            account: { tier: "free", can_send: true, using_sandbox: true },
            onboarding: { first_send: { completed: false } },
            provider: { name: "mailgun", configured: false },
            billing: { tier: "free" }
          }
        })
      }]
    }
  }), { status: 200 });

  try {
    const io = streams();
    const code = await runCli({ argv: ["--json"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.data.status_source, "live");
    assert.equal(parsed.data.onboarding.first_send, false);
    assert.ok(parsed.sidecars.blockers.includes("Onboarding setup is not completed"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    if (previousCache === undefined) delete process.env.NITROSEND_CACHE_DIR;
    else process.env.NITROSEND_CACHE_DIR = previousCache;
    await rm(dir, { recursive: true, force: true });
  }
});

test("status command returns parsed MCP status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-status-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  globalThis.fetch = async () => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify({ result: { status: "ready" } }) }]
    }
  }), { status: 200 });

  try {
    const io = streams();
    const code = await runCli({ argv: ["status", "--json"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.command, "status");
    assert.equal(parsed.data.status, "ready");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("trace exposes HTTP failure status and body preview in json errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-trace-http-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  globalThis.fetch = async () => new Response("Host not in allowlist", {
    status: 403,
    headers: { "Content-Type": "text/plain", "X-Request-Id": "req_456" }
  });

  try {
    const io = streams();
    const code = await runCli({ argv: ["status", "--json", "--trace"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 77);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "authentication_failed");
    assert.match(parsed.error.message, /check api\.example\.test is reachable/);
    assert.equal(parsed.meta.trace[0].name, "mcp tools/call");
    assert.equal(parsed.meta.trace[0].response_status, 403);
    assert.equal(parsed.meta.trace[0].response_body_preview, "Host not in allowlist");
    assert.match(io.stderrText, /body="Host not in allowlist"/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("entity list commands call nitro_query and render rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-flows-list-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            result: {
              items: [{ id: 1, name: "Welcome", status: "draft" }],
              pagination: { page: 1, per: 10, total: 1 }
            }
          })
        }]
      }
    }), { status: 200 });
  };

  try {
    const io = streams();
    const code = await runCli({
      argv: ["flows", "list", "--status", "draft", "--per", "10", "--json"],
      stdout: io.stdout,
      stderr: io.stderr
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.command, "flows list");
    assert.equal(parsed.data.rows[0].name, "Welcome");
    const body = JSON.parse(requestBody);
    assert.equal(body.params.name, "nitro_query");
    assert.deepEqual(body.params.arguments.filters, { status: "draft" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("suppressions list maps filters to nitro_query", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-suppressions-list-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            result: {
              items: [{
                id: 1,
                email: "user@example.com",
                reason: "hard_bounce",
                provider_diagnostic: "550 invalid recipient"
              }],
              pagination: { page: 1, per: 10, total: 1 }
            }
          })
        }]
      }
    }), { status: 200 });
  };

  try {
    const io = streams();
    const code = await runCli({
      argv: [
        "suppressions", "list",
        "--reason", "hard_bounce",
        "--source-provider", "sendgrid",
        "--active", "false",
        "--per", "10",
        "--json"
      ],
      stdout: io.stdout,
      stderr: io.stderr
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.command, "suppressions list");
    assert.equal(parsed.data.rows[0].provider_diagnostic, "550 invalid recipient");
    const body = JSON.parse(requestBody);
    assert.equal(body.params.name, "nitro_query");
    assert.deepEqual(body.params.arguments.filters, {
      reason: "hard_bounce",
      source_provider: "sendgrid",
      active: false
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("contacts import command direct uploads and renders guardrail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-import-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.NITROSEND_CONFIG_DIR = dir;
  const file = join(dir, "contacts.csv");
  await writeFile(file, "Email\nalice@example.com\n");

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profiles.json"), JSON.stringify({
    currentProfile: "default",
    profiles: {
      default: {
        name: "default",
        apiUrl: "https://api.example.test/mcp",
        token: "nskey_test_abc123",
        tokenType: "api_key"
      }
    }
  }));

  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url);
    calls.push(`${init?.method || "GET"} ${requestUrl}`);
    if (requestUrl.endsWith("/v1/direct_uploads")) {
      return new Response(JSON.stringify({
        signed_id: "signed-blob",
        direct_upload: {
          url: "https://s3.example.test/upload",
          headers: { "Content-Type": "text/csv" }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (requestUrl === "https://s3.example.test/upload") {
      return new Response("", { status: 200 });
    }
    if (requestUrl.endsWith("/v1/my/imports")) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.options, { list_ids: [88] });
      return new Response(JSON.stringify({
        id: 42,
        status: "pending",
        guardrail: { tier: "hold_sends", status: "requires_review", sends_held: true }
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected URL ${requestUrl}`);
  };

  try {
    const io = streams();
    const code = await runCli({
      argv: ["contacts", "import", file, "--list-id", "88", "--json"],
      stdout: io.stdout,
      stderr: io.stderr
    });

    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.command, "contacts import");
    assert.equal(parsed.data.guardrail_tier, "hold_sends");
    assert.equal(parsed.data.guardrail_status, "requires_review");
    assert.deepEqual(calls, [
      "POST https://api.example.test/v1/direct_uploads",
      "PUT https://s3.example.test/upload",
      "POST https://api.example.test/v1/my/imports"
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("version and update commands provide release guidance", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ version: CURRENT_VERSION }), { status: 200 });
  const versionIo = streams();
  try {
    const versionCode = await runCli({ argv: ["version", "--json"], stdout: versionIo.stdout, stderr: versionIo.stderr });
    assert.equal(versionCode, 0);
    const version = JSON.parse(versionIo.stdoutText);
    assert.equal(version.data.package, "@nitrosend/cli");
    assert.ok(version.data.update_command.includes("@nitrosend/cli@latest"));

    const rawIo = streams();
    const rawCode = await runCli({ argv: ["--version"], stdout: rawIo.stdout, stderr: rawIo.stderr });
    assert.equal(rawCode, 0);
    assert.match(rawIo.stdoutText, /^\d+\.\d+\.\d+/);

    const updateIo = streams();
    const updateCode = await runCli({ argv: ["update", "--json"], stdout: updateIo.stdout, stderr: updateIo.stderr });
    assert.equal(updateCode, 0);
    const update = JSON.parse(updateIo.stdoutText);
    assert.equal(update.data.status, "up_to_date");
    assert.equal(update.data.latest_version, CURRENT_VERSION);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("machine mode does not assign idempotency keys to read commands", async () => {
  const io = streams();
  const code = await runCli({ argv: ["version", "--machine"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  const parsed = JSON.parse(io.stdoutText);
  assert.equal(parsed.meta.idempotency_key, undefined);
});

test("fixture preview human output avoids duplicate affected blast radius", async () => {
  const io = streams();
  const code = await runCli({ argv: ["fixture", "destroy", "demo", "--dry-run"], stdout: io.stdout, stderr: io.stderr });

  assert.equal(code, 0);
  assert.doesNotMatch(io.stdoutText, /^Affected:/m);
  assert.match(io.stdoutText, /^Blast radius:/m);
});

test("redo replays read-safe commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-redo-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;
  try {
    await runCli({ argv: ["describe", "whoami"], stdout: streams().stdout, stderr: streams().stderr });

    const io = streams();
    const code = await runCli({ argv: ["redo", "1", "--json"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.data.replayed, true);
    assert.equal(parsed.data.result.command, "describe");
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("redo refuses unsafe replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-redo-refuse-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;
  try {
    await runCli({
      argv: ["fixture", "destroy", "demo", "--dry-run"],
      stdout: streams().stdout,
      stderr: streams().stderr
    });

    const io = streams();
    const code = await runCli({ argv: ["redo", "1", "--json"], stdout: io.stdout, stderr: io.stderr });
    assert.equal(code, 0);
    const parsed = JSON.parse(io.stdoutText);
    assert.equal(parsed.data.replayed, false);
    assert.equal(parsed.data.status, "refused");
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
