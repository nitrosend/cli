import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretResourceResult,
  interpretToolResult,
  parseToolJson,
  safetyClassFromTool,
  safetyClassFromToolName
} from "./result.js";

test("interprets MCP tool isError results as data errors", () => {
  const interpreted = interpretToolResult({
    isError: true,
    content: [{ type: "text", text: "Missing required arguments: entity" }]
  });

  assert.equal(interpreted.ok, false);
  if (!interpreted.ok) {
    assert.equal(interpreted.error.code, "mcp_tool_error");
    assert.equal(interpreted.error.exitCodeName, "data");
    assert.match(interpreted.error.message, /Missing required arguments/);
  }
});

test("interprets resource text error envelopes", () => {
  const interpreted = interpretResourceResult({
    contents: [{
      uri: "nitro://does-not-exist",
      mimeType: "text/plain",
      text: JSON.stringify({ error: true, code: "not_found", message: "Unknown resource" })
    }]
  });

  assert.equal(interpreted.ok, false);
  if (!interpreted.ok) {
    assert.equal(interpreted.error.code, "not_found");
    assert.equal(interpreted.error.exitCodeName, "data");
  }
});

test("parses successful tool JSON text content", () => {
  const parsed = parseToolJson<{ result: { status: string } }>({
    content: [{ type: "text", text: JSON.stringify({ result: { status: "ready" } }) }]
  });

  assert.deepEqual(parsed, { result: { status: "ready" } });
});

test("maps MCP annotations and names to existing safety classes", () => {
  assert.equal(safetyClassFromTool({ name: "nitro_get_status", annotations: { readOnlyHint: true } }), "read");
  assert.equal(safetyClassFromTool({ name: "nitro_control_delivery", annotations: { destructiveHint: true } }), "destructive");
  assert.equal(safetyClassFromToolName("nitro_send_test_message"), "external-effect");
  assert.equal(safetyClassFromToolName("nitro_manage_billing"), "billing");
  assert.equal(safetyClassFromToolName("nitro_configure_providers"), "provider-credential");
});
