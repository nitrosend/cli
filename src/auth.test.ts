import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loginWithApiKey, resolveAuth, signupWithPassword, validateApiKey } from "./auth.js";
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

test("resolves a named profile, and names it when it is missing", async () => {
  await withConfigDir(async () => {
    await loginWithApiKey("nskey_test_first", { profile: "first", apiUrl: "https://api.example.test/mcp" });
    await loginWithApiKey("nskey_test_second", { profile: "second", apiUrl: "https://api.example.test/mcp" });

    assert.equal((await resolveAuth("first")).token, "nskey_test_first");
    assert.equal((await resolveAuth("second")).token, "nskey_test_second");
    await assert.rejects(resolveAuth("missing"), /Profile missing is not logged in/);
  });
});

const FRESH_KEY = "nskey_live_fresh123";

test("signs up over REST, makes an API key with the session, and stores only the key", async () => {
  await withConfigDir(async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      if (String(url).endsWith("/v1/signup")) {
        return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { Authorization: "Bearer session-jwt" } });
      }
      return new Response(JSON.stringify({ id: 2, secret_key: FRESH_KEY }), { status: 201 });
    }) as typeof fetch;

    const profile = await signupWithPassword({
      email: "agent@example.test",
      password: "hunter2",
      profile: "default",
      apiUrl: "https://api.example.test/mcp",
      attribution: { utm_source: "docs" },
      fetcher
    });

    assert.deepEqual(calls.map((call) => call.url), [
      "https://api.example.test/v1/signup",
      "https://api.example.test/v1/my/api_keys"
    ]);
    assert.deepEqual(calls[0].body, {
      user: { email: "agent@example.test", password: "hunter2", attribution_context: { utm_source: "docs" } }
    });
    assert.equal(calls[1].headers.get("authorization"), "Bearer session-jwt");
    assert.equal(profile.token, FRESH_KEY);
    assert.equal((await resolveAuth()).token, FRESH_KEY);
  });
});

test("a refused signup stops before any key is made", async () => {
  await withConfigDir(async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "Email has already been taken" }), { status: 422 });
    }) as typeof fetch;

    await assert.rejects(
      signupWithPassword({ email: "taken@example.test", password: "pw", profile: "default", apiUrl: "https://api.example.test/mcp", fetcher }),
      /already been taken/
    );
    assert.equal(calls, 1);
  });
});

async function withConfigDir(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  const previousKey = process.env.NITROSEND_API_KEY;
  process.env.NITROSEND_CONFIG_DIR = dir;
  delete process.env.NITROSEND_API_KEY;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    if (previousKey !== undefined) process.env.NITROSEND_API_KEY = previousKey;
    await rm(dir, { recursive: true, force: true });
  }
}
