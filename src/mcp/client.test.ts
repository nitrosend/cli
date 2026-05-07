import assert from "node:assert/strict";
import test from "node:test";
import { AuthContext } from "../auth.js";
import { createTraceStore, runWithTraceStore } from "../runtime/trace.js";
import { VersionGate } from "../version/gate.js";
import { McpClient } from "./client.js";

const auth: AuthContext = {
  token: "nskey_test_abc123",
  tokenType: "api_key",
  apiUrl: "https://api.example.test/mcp",
  source: "env"
};

test("sends direct HTTP JSON-RPC requests", async () => {
  let requestBody = "";
  const client = new McpClient({
    auth,
    gate: new VersionGate({ currentVersion: "0.1.0", stderr: { write: () => true } }),
    fetcher: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
        status: 200,
        headers: { "X-Nitrosend-CLI-Latest": "0.1.0", "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.listTools();
  assert.deepEqual(result, { tools: [] });
  assert.equal(JSON.parse(requestBody).method, "tools/list");
});

test("surfaces JSON-RPC errors", async () => {
  const client = new McpClient({
    auth,
    fetcher: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Nope" }
    }), { status: 200 })
  });

  await assert.rejects(() => client.listTools(), /Nope/);
});

test("classifies non-json HTTP auth failures before parsing", async () => {
  const trace = createTraceStore(true);
  const client = new McpClient({
    auth,
    fetcher: async () => new Response("Host not in allowlist", {
      status: 403,
      headers: { "Content-Type": "text/plain", "X-Request-Id": "req_123" }
    })
  });

  await runWithTraceStore(trace, async () => {
    await assert.rejects(
      () => client.listTools(),
      (error) => {
        assert.equal((error as { code?: string }).code, "authentication_failed");
        assert.match((error as Error).message, /Authentication failed \(HTTP 403\)/);
        assert.doesNotMatch((error as Error).message, /not valid JSON/);
        return true;
      }
    );
  });

  assert.equal(trace.events[0].response_status, 403);
  assert.equal(trace.events[0].response_body_preview, "Host not in allowlist");
  assert.equal(trace.events[0].response_headers?.["x-request-id"], "req_123");
});

test("classifies successful non-json MCP responses as invalid API responses", async () => {
  const client = new McpClient({
    auth,
    fetcher: async () => new Response("not json", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    })
  });

  await assert.rejects(
    () => client.listTools(),
    (error) => {
      assert.equal((error as { code?: string }).code, "invalid_json_response");
      assert.match((error as Error).message, /Unexpected response from MCP \(HTTP 200\): response was not JSON/);
      return true;
    }
  );
});
