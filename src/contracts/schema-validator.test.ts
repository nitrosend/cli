import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CliError, errorEnvelope } from "../errors.js";
import { commandResult } from "./types.js";
import { assertValidSchema, validateSchema } from "./schema-validator.js";

const resultSchema = readJson("../../schemas/command-result.schema.json");
const errorSchema = readJson("../../schemas/command-error.schema.json");
const streamEventSchema = readJson("../../schemas/stream-event.schema.json");

test("validates command result envelopes against the shipped schema", () => {
  assertValidSchema(resultSchema, commandResult("dashboard", { profile: "default" }), "command result");
});

test("validates command error envelopes against the shipped schema", () => {
  const envelope = errorEnvelope(new CliError("No active profile", { code: "not_authenticated", exitCodeName: "permission" }));
  assertValidSchema(errorSchema, envelope, "command error");
});

test("validates stream event envelopes against the shipped schema", () => {
  assertValidSchema(streamEventSchema, {
    schema_version: 1,
    type: "started",
    command: "mcp tools call",
    data: { name: "nitro_get_status" }
  }, "stream event");
});

test("validates golden dashboard fixture against the result schema", () => {
  assertValidSchema(resultSchema, readJson("../../fixtures/golden/dashboard.json"), "golden dashboard");
});

test("reports missing required fields", () => {
  const errors = validateSchema(resultSchema, { ok: true });
  assert.ok(errors.some((error) => error.includes("$.schema_version is required")));
});

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as unknown;
}
