import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchJson, uploadContactsImport } from "./http.js";
import { CURRENT_VERSION } from "./version/current.js";

const USER_AGENT = `nitrosend-cli/${CURRENT_VERSION}`;

test("fetchJson identifies the CLI with a versioned User-Agent and keeps caller headers", async () => {
  let headers = new Headers();
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  await fetchJson("https://api.example.test/oauth/token", {
    method: "POST",
    headers: { Authorization: "Bearer nskey_test_abc" }
  }, { fetcher: fetcher as typeof fetch });

  assert.match(USER_AGENT, /^nitrosend-cli\/\d+\.\d+\.\d+/);
  assert.equal(headers.get("user-agent"), USER_AGENT);
  assert.equal(headers.get("authorization"), "Bearer nskey_test_abc");
  assert.equal(headers.get("accept"), "application/json");
});

test("uploadContactsImport performs Active Storage direct upload then creates import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-import-"));
  const file = join(dir, "contacts.csv");
  await writeFile(file, "Email\nalice@example.com\n");

  const calls: Array<{ url: string; method: string; body?: unknown; headers: Record<string, string> }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: requestUrl, method: init?.method || "GET", body: init?.body, headers });

    if (requestUrl.endsWith("/v1/direct_uploads")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.purpose, "import");
      assert.equal(body.blob.filename, "contacts.csv");
      assert.equal(body.blob.byte_size, 24);
      assert.equal(typeof body.blob.checksum, "string");
      return new Response(JSON.stringify({
        signed_id: "signed-blob",
        direct_upload: {
          url: "https://s3.example.test/upload",
          headers: { "Content-Type": "text/csv" }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (requestUrl === "https://s3.example.test/upload") {
      assert.equal(init?.method, "PUT");
      assert.equal(headers["content-md5"]?.length, 24);
      return new Response("", { status: 200 });
    }

    if (requestUrl.endsWith("/v1/my/imports")) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        signed_id: "signed-blob",
        resource: "contacts",
        options: { list_ids: [88] }
      });
      return new Response(JSON.stringify({
        id: 42,
        status: "pending",
        guardrail: { tier: "auto", status: "ok", standing: "trusted", max_rows: null }
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    }

    throw new Error(`unexpected URL ${requestUrl}`);
  };

  try {
    const result = await uploadContactsImport({
      apiUrl: "https://api.example.test/mcp",
      token: "nskey_test_abc",
      filePath: file,
      listId: 88,
      fetcher: fetcher as typeof fetch
    });

    assert.equal(result.id, 42);
    assert.equal(result.guardrail?.tier, "auto");
    assert.equal(result.guardrail?.standing, "trusted");
    assert.deepEqual(calls.map((call) => [call.method, call.url]), [
      ["POST", "https://api.example.test/v1/direct_uploads"],
      ["PUT", "https://s3.example.test/upload"],
      ["POST", "https://api.example.test/v1/my/imports"]
    ]);
    assert.deepEqual(calls.map((call) => call.headers["user-agent"]), [USER_AGENT, USER_AGENT, USER_AGENT]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
