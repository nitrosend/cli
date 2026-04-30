import assert from "node:assert/strict";
import test from "node:test";
import { AuthContext } from "../auth.js";
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
