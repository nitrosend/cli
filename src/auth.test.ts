import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loginWithApiKey, resolveAuth, signupWithPassword, completeSignup, validateApiKey } from "./auth.js";
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

test("pending signup changes no existing profile and creates no key", async () => {
  await withConfigDir(async () => {
    await loginWithApiKey("nskey_test_working", { profile: "default" });
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error_code: "verification_required" }), { status: 409 });
    }) as typeof fetch;
    const result = await signupWithPassword({ email: "pending@example.test", password: "initial", profile: "default", fetcher });
    assert.equal(result.status, "verification_required");
    assert.equal(calls, 1);
    assert.equal((await resolveAuth()).token, "nskey_test_working");
  });
});

test("activation survives failed key creation and resume preserves the previous profile until success", async () => {
  await withConfigDir(async () => {
    await loginWithApiKey("nskey_test_working", { profile: "default" });
    const calls: string[] = [];
    let failKey = true;
    const fetcher = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (!String(url).endsWith("/api_keys")) return new Response('{"id":1}', { headers: { Authorization: "Bearer private-session" } });
      if (failKey) return new Response('{"message":"private-session should never be reflected"}', { status: 503 });
      return new Response(JSON.stringify({ secret_key: FRESH_KEY }));
    }) as typeof fetch;
    await assert.rejects(completeSignup({ token: "proof", password: "final-pass", profile: "default", fetcher }), (error: unknown) => {
      assert.match(String(error), /CLI profile could not be saved/);
      assert.doesNotMatch(String(error), /private-session/);
      return true;
    });
    assert.equal((await resolveAuth()).token, "nskey_test_working");
    failKey = false;
    await completeSignup({ email: "owner@example.test", password: "final-pass", profile: "default", fetcher });
    assert.equal((await resolveAuth()).token, FRESH_KEY);
    assert.ok(calls[0].endsWith("/signup/verify"));
    assert.ok(calls[2].endsWith("/signup/activate"));
  });
});

test("profile storage failure after activation is recoverable without exposing the new credential", async () => {
  await withConfigDir(async () => {
    const path = join(process.env.NITROSEND_CONFIG_DIR!, "profiles.json");
    await mkdir(path); // Real filesystem failure: a directory cannot be read as a profile file.
    const fetcher = (async (url: string | URL | Request) => String(url).endsWith("/api_keys")
      ? new Response(JSON.stringify({ secret_key: FRESH_KEY }))
      : new Response('{"id":1}', { headers: { Authorization: "Bearer private-session" } })) as typeof fetch;
    await assert.rejects(completeSignup({ token: "proof", password: "final-pass", profile: "default", fetcher }), /CLI profile could not be saved/);
    await rm(path, { recursive: true });
    await completeSignup({ email: "owner@example.test", password: "final-pass", profile: "default", fetcher });
    assert.equal((await resolveAuth()).token, FRESH_KEY);
  });
});

test("expired proof and exhausted capacity never create keys or replace a profile", async () => {
  await withConfigDir(async () => {
    await loginWithApiKey("nskey_test_working", { profile: "default" });
    for (const status of [422, 429]) {
      let calls = 0;
      const fetcher = (async () => { calls += 1; return new Response('{"message":"Try again"}', { status }); }) as typeof fetch;
      await assert.rejects(completeSignup({ token: "proof", password: "final-pass", profile: "default", fetcher }));
      assert.equal(calls, 1);
      assert.equal((await resolveAuth()).token, "nskey_test_working");
    }
  });
});

test("verifies over REST, makes an API key with the session, and stores only the key", async () => {
  await withConfigDir(async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      if (String(url).endsWith("/v1/signup/verify")) {
        return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { Authorization: "Bearer session-jwt" } });
      }
      return new Response(JSON.stringify({ id: 2, secret_key: FRESH_KEY }), { status: 201 });
    }) as typeof fetch;

    const profile = await completeSignup({
      token: "email-proof",
      password: "hunter2",
      profile: "default",
      apiUrl: "https://api.example.test/mcp",
      fetcher
    });

    assert.deepEqual(calls.map((call) => call.url), [
      "https://api.example.test/v1/signup/verify",
      "https://api.example.test/v1/my/api_keys"
    ]);
    assert.deepEqual(calls[0].body, {
      token: "email-proof", password: "hunter2"
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
