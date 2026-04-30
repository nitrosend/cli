import assert from "node:assert/strict";
import test from "node:test";
import { commandResult } from "./contracts/types.js";
import { renderError, renderResult } from "./renderers/index.js";
import { errorEnvelope } from "./errors.js";

test("renders schema_version in JSON success output", () => {
  const output = renderResult(commandResult("whoami", { profile: "default" }), { mode: "json", color: false });
  const parsed = JSON.parse(output);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.ok, true);
});

test("renders tables as CSV", () => {
  const result = commandResult("recent", { rows: [{ index: 1, command: "nitrosend whoami" }] }, {
    presentation: { type: "table", columns: [{ key: "index", label: "Index" }, { key: "command", label: "Command" }] }
  });
  assert.equal(renderResult(result, { mode: "csv", color: false }), "index,command\n1,nitrosend whoami\n");
});

test("renders structured error JSON", () => {
  const output = renderError(errorEnvelope(new Error("Nope"), { command: "test" }), { mode: "json", color: false });
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.message, "Nope");
});
