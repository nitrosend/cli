import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./cli.js";

interface CapturedRun {
  code: number;
  stdout: string;
  stderr: string;
  requests: Array<Record<string, unknown>>;
}

test("inbox queue and item map to nitro_inbox read commands", async () => {
  const queue = await runWithMcp(
    ["inbox", "queue", "--state", "needs_attention", "--page", "2", "--per", "10", "--json"],
    [{ items: [{ action_item_id: 456, state: "needs_human" }], pagination: { page: 2 }, counts: { needs_human: 1 } }]
  );
  assert.equal(queue.code, 0);
  assert.equal(JSON.parse(queue.stdout).data.rows[0].action_item_id, 456);
  assert.deepEqual(toolCall(queue.requests[0]), {
    name: "nitro_inbox",
    arguments: { command: "list_queue", state: "needs_attention", page: 2, per: 10 }
  });

  const item = await runWithMcp(
    ["inbox", "item", "456", "--json"],
    [{ item: { action_item_id: 456 }, reply_context: { context_digest: "digest-1" } }]
  );
  assert.equal(item.code, 0);
  assert.deepEqual(toolCall(item.requests[0]), {
    name: "nitro_inbox",
    arguments: { command: "get_item", action_item_id: 456 }
  });
});

test("inbox reply fails closed without typed confirmation", async () => {
  const result = await runWithMcp(
    ["inbox", "reply", "123", "--body", "Send this", "--machine"],
    []
  );

  assert.equal(result.code, 77);
  assert.equal(result.requests.length, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "typed_confirmation_required");
});

test("inbox reply dry-run fetches current context and validates without confirmation", async () => {
  const result = await runWithMcp(
    ["inbox", "reply", "123", "--body", "Draft reply", "--subject", "Re: Help", "--dry-run", "--json"],
    [
      { thread: { conversation_id: 123 }, reply_context: { context_digest: "digest-123" } },
      { command: "send_reply", status: "dry_run_valid" }
    ]
  );

  assert.equal(result.code, 0);
  assert.deepEqual(toolCall(result.requests[0]), {
    name: "nitro_inbox",
    arguments: { command: "get_thread", conversation_id: 123 }
  });
  const action = toolCall(result.requests[1]);
  assert.equal(action.name, "nitro_inbox_action");
  assert.deepEqual(action.arguments, {
    command: "send_reply",
    conversation_id: 123,
    subject: "Re: Help",
    body: "Draft reply",
    reply_context_digest: "digest-123",
    idempotency_key: action.arguments.idempotency_key,
    dry_run: true
  });
  assert.match(String(action.arguments.idempotency_key), /^cli-[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(result.stdout).meta.idempotency_key, action.arguments.idempotency_key);
});

test("inbox reply uses the existing test-send command for an explicit test recipient", async () => {
  const result = await runWithMcp(
    [
      "inbox", "reply", "123", "--html", "<p>Draft</p>", "--test-to", "owner@example.com",
      "--idempotency-key", "reply-demo-1", "--confirm", "123", "--json"
    ],
    [
      { thread: { conversation_id: 123 }, reply_context: { context_digest: "digest-123" } },
      { command: "send_reply_test", status: "sent" }
    ]
  );

  assert.equal(result.code, 0);
  assert.deepEqual(toolCall(result.requests[1]), {
    name: "nitro_inbox_action",
    arguments: {
      command: "send_reply_test",
      conversation_id: 123,
      html: "<p>Draft</p>",
      to: ["owner@example.com"],
      reply_context_digest: "digest-123",
      idempotency_key: "reply-demo-1",
      dry_run: false
    }
  });
});

test("inbox action maps CLI disposition names and sends an idempotency key", async () => {
  const result = await runWithMcp(
    ["inbox", "action", "456", "release-to-agent", "--idempotency-key", "action-456-1", "--json"],
    [{ command: "release_to_agent", status: "ok" }]
  );

  assert.equal(result.code, 0);
  assert.deepEqual(toolCall(result.requests[0]), {
    name: "nitro_inbox_action",
    arguments: {
      command: "release_to_agent",
      action_item_id: 456,
      idempotency_key: "action-456-1"
    }
  });
});

test("inbox descriptors expose send safety and idempotency", async () => {
  const result = await runWithMcp(["describe", "inbox", "reply", "--json"], []);

  assert.equal(result.code, 0);
  const descriptor = JSON.parse(result.stdout).data;
  assert.equal(descriptor.safety.class, "external-effect");
  assert.equal(descriptor.safety.requires_confirmation, true);
  assert.equal(descriptor.safety.supports_dry_run, true);
  assert.equal(descriptor.idempotency.mode, "auto");
});

async function runWithMcp(argv: string[], results: Array<Record<string, unknown>>): Promise<CapturedRun> {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-inbox-"));
  const previousConfig = process.env.NITROSEND_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  let responseIndex = 0;
  let stdout = "";
  let stderr = "";

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

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const result = results[responseIndex++];
    if (!result) throw new Error("Unexpected MCP request");
    return toolResponse(result);
  };

  try {
    const code = await runCli({
      argv,
      stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
      stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
    });
    return { code, stdout, stderr, requests };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
}

function toolResponse(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: JSON.stringify({ result }) }]
    }
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function toolCall(request: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
  const params = request.params as Record<string, unknown>;
  return {
    name: String(params.name),
    arguments: params.arguments as Record<string, unknown>
  };
}
