import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHistory, recordHistory } from "./history.js";

test("history redacts reply content and raw MCP arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nitrosend-cli-history-"));
  const previous = process.env.NITROSEND_CONFIG_DIR;
  process.env.NITROSEND_CONFIG_DIR = dir;

  try {
    await recordHistory([
      "inbox", "reply", "123",
      "--body", "private body",
      "--html=<p>private html</p>",
      "--args", "{\"private\":true}"
    ]);

    const history = await readHistory();
    assert.equal(
      history[0].command,
      "nitrosend inbox reply 123 --body [redacted] --html=[redacted] --args [redacted]"
    );
  } finally {
    if (previous === undefined) delete process.env.NITROSEND_CONFIG_DIR;
    else process.env.NITROSEND_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
