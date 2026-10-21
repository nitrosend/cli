import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { parseArgs } from "../args.js";
import { browserCommand, loginWithOAuth, resolveAuth } from "../auth.js";
import { runCli } from "../cli.js";
import { rpcError } from "../mcp/client.js";
import { assertKnownFlags } from "../runtime/options.js";
import { resolveExecution } from "../runtime/resolve.js";
import { COMMAND_DESCRIPTORS, KNOWN_FLAGS } from "./descriptors.js";
import { parseUsage, usageInputSchema } from "./usage.js";

test("send's usage line becomes its input schema", () => {
  const spec = parseUsage(
    "nitrosend send --to <recipient> (--subject <text> --body <text>|--template-id <id>) [--channel email|sms] [--idempotency-key <key>] [--dry-run]",
    "send"
  );
  assert.deepEqual(usageInputSchema(spec), {
    type: "object",
    properties: {
      flags: {
        type: "object",
        properties: {
          to: { type: "string", description: "<recipient>" },
          subject: { type: "string", description: "<text>" },
          body: { type: "string", description: "<text>" },
          "template-id": { type: "string", description: "<id>" },
          channel: { type: "string", enum: ["email", "sms"], description: "email" },
          "idempotency-key": { type: "string", description: "<key>" },
          "dry-run": { type: "boolean" }
        },
        required: ["to"],
        oneOf: [{ required: ["subject", "body"] }, { required: ["template-id"] }]
      }
    }
  });
});

test("positionals keep their order, and a listed placeholder becomes an enum", () => {
  const spec = parseUsage("nitrosend completion <bash|zsh|fish>", "completion");
  assert.deepEqual(spec.positionals, [{ name: "bash|zsh|fish", required: true, values: ["bash", "zsh", "fish"] }]);
});

test("an unbalanced usage line is refused", () => {
  assert.throws(() => parseUsage("nitrosend send [--to <recipient>", "send"), /Expected \]/);
});

test("every descriptor's examples parse as that command with known flags", () => {
  for (const descriptor of COMMAND_DESCRIPTORS) {
    for (const example of descriptor.examples) {
      const argv = shellWords(example.command.slice(example.command.indexOf("nitrosend") + "nitrosend".length));
      const parsed = parseArgs(argv);
      assert.doesNotThrow(() => assertKnownFlags(parsed.flags), example.command);
      assert.equal(resolveExecution(parsed.positionals).descriptor.name, descriptor.name, example.command);
    }
  }
});

test("a flag written without a value in any usage line parses as a boolean", () => {
  assert.equal(KNOWN_FLAGS.get("password-stdin")?.type, "boolean");
  assert.deepEqual(parseArgs(["signup", "--email", "a@example.test", "--password-stdin"]).flags, {
    email: "a@example.test",
    "password-stdin": true
  });
  assert.equal(parseArgs(["signup", "--password-stdin=true"]).flags["password-stdin"], true);
  assert.throws(() => parseArgs(["signup", "--password-stdin=yes"]), /--password-stdin takes no value/);
});

test("the documented signup example signs up from stdin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-"));
  const previous = { config: process.env.NITROSEND_CONFIG_DIR, key: process.env.NITROSEND_API_KEY, fetch: globalThis.fetch };
  process.env.NITROSEND_CONFIG_DIR = dir;
  delete process.env.NITROSEND_API_KEY;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (String(url).endsWith("/v1/signup")) {
      return new Response("{}", { status: 201, headers: { Authorization: "Bearer session-jwt" } });
    }
    return new Response(JSON.stringify({ secret_key: "nskey_live_fromsignup" }), { status: 201 });
  }) as typeof fetch;

  try {
    const signup = COMMAND_DESCRIPTORS.find((descriptor) => descriptor.name === "signup");
    const example = signup?.examples[0].command ?? "";
    const argv = shellWords(example.slice(example.indexOf("nitrosend") + "nitrosend".length));
    const io = { out: "", err: "" };
    const code = await runCli({
      argv: [...argv, "--utm-source", "docs", "--json"],
      stdin: Readable.from(["hunter2\n"]),
      stdout: { write: (chunk: string) => { io.out += chunk; return true; } },
      stderr: { write: (chunk: string) => { io.err += chunk; return true; } },
      cwd: dir
    });

    assert.equal(code, 0, io.out + io.err);
    assert.deepEqual(bodies[0], {
      user: { email: "you@example.com", password: "hunter2", attribution_context: { utm_source: "docs" } }
    });
    assert.equal((await resolveAuth()).token, "nskey_live_fromsignup");
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.config === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous.config;
    if (previous.key !== undefined) process.env.NITROSEND_API_KEY = previous.key;
    await rm(dir, { recursive: true, force: true });
  }
});

test("--no-browser login prints the sign-in URL before it waits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-"));
  const previous = { config: process.env.NITROSEND_CONFIG_DIR, fetch: globalThis.fetch };
  process.env.NITROSEND_CONFIG_DIR = dir;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (target.endsWith("/.well-known/oauth-protected-resource/mcp")) {
      return Response.json({ authorization_servers: ["https://auth.example.test"] });
    }
    if (target.endsWith("/.well-known/oauth-authorization-server")) {
      return Response.json({
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        registration_endpoint: "https://auth.example.test/register"
      });
    }
    if (target.endsWith("/register")) return Response.json({ client_id: "cli-client" });
    return Response.json({ access_token: "oauth-token", token_type: "Bearer" });
  }) as typeof fetch;

  try {
    const notices: string[] = [];
    let signedIn: Promise<Response> | undefined;
    const profile = await loginWithOAuth({
      profile: "default",
      apiUrl: "https://api.example.test/mcp",
      openBrowser: false,
      notice: (text) => {
        notices.push(text);
        const url = text.match(/https:\/\/auth\.example\.test\/authorize\S+/)?.[0];
        if (!url) return;
        const authorize = new URL(url);
        const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
        callback.searchParams.set("code", "auth-code");
        callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
        signedIn = realFetch(callback);
      }
    });

    assert.match(notices[0], /^Open this URL in a browser to sign in:\n {2}https:\/\/auth\.example\.test\/authorize\?/);
    assert.ok(signedIn, "the URL was printed before the wait began");
    await signedIn;
    assert.equal(profile.token, "oauth-token");
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.config === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous.config;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows opens the sign-in URL whole", () => {
  const url = "https://auth.example.test/authorize?response_type=code&client_id=a&state=b";
  assert.deepEqual(browserCommand(url, "win32"), { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] });
  assert.deepEqual(browserCommand(url, "darwin"), { command: "open", args: [url] });
});

test("a tool the account lacks names the missing feature", () => {
  const error = rpcError("Tool not found: nitro_inbox");
  assert.equal(error.code, "tool_unavailable");
  assert.match(error.message, /does not have the agent inbox enabled/);
  assert.equal(rpcError("Invalid params").code, "mcp_json_rpc_error");
});

function shellWords(command: string): string[] {
  return [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}
