import assert from "node:assert/strict";
import test from "node:test";
import { findDescriptor } from "../contracts/descriptors.js";
import { enforceSafety } from "./index.js";

test("typed confirmations fail closed in non-interactive mode", async () => {
  const descriptor = findDescriptor("fixture destroy");
  assert.ok(descriptor);

  await assert.rejects(
    () => enforceSafety(descriptor, "demo", {
      dryRun: false,
      yes: false,
      nonInteractive: true,
      environment: "sandbox"
    }),
    /Typed confirmation required/
  );
});

test("dry-run bypasses destructive confirmation", async () => {
  const descriptor = findDescriptor("fixture destroy");
  assert.ok(descriptor);

  await assert.doesNotReject(() => enforceSafety(descriptor, "demo", {
    dryRun: true,
    yes: false,
    nonInteractive: true,
    environment: "production"
  }));
});
