import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loginWithApiKey, resolveAuth, validateApiKey } from "./auth.js";
import { redact } from "./redact.js";

test("stores and resolves API-key profile outside repo paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;

  try {
    await loginWithApiKey("nskey_test_abc123", {
      profile: "default",
      apiUrl: "https://api.example.test/mcp"
    });
    const auth = await resolveAuth();
    assert.equal(auth.tokenType, "api_key");
    assert.equal(auth.apiUrl, "https://api.example.test/mcp");
  } finally {
    if (previous === undefined) {
      delete process.env.NITROSEND_CONFIG_DIR;
    } else {
      process.env.NITROSEND_CONFIG_DIR = previous;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepts live and test API key prefixes", () => {
  assert.doesNotThrow(() => validateApiKey("nskey_live_abc123"));
  assert.doesNotThrow(() => validateApiKey("nskey_test_abc123"));
  assert.throws(() => validateApiKey("bad"));
});

test("redacts token-like values", () => {
  assert.equal(redact("use nskey_test_abcdefghijklmnopqrstuvwxyz"), "use nskey_test_abc...[redacted]");
});
