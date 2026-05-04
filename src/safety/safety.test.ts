import assert from "node:assert/strict";
import { Readable } from "node:stream";
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

test("typed confirmations fail closed when stdin is not a tty", async () => {
  const descriptor = findDescriptor("fixture destroy");
  assert.ok(descriptor);
  const stdin = new Readable({ read() {} });
  Object.defineProperty(stdin, "isTTY", { value: false });

  await assert.rejects(
    () => enforceSafety(descriptor, "demo", {
      dryRun: false,
      yes: false,
      nonInteractive: false,
      environment: "sandbox",
      stdin
    }),
    /Typed confirmation required/
  );
});

test("correct typed confirmation succeeds without a tty", async () => {
  const descriptor = findDescriptor("fixture destroy");
  assert.ok(descriptor);
  const stdin = new Readable({ read() {} });
  Object.defineProperty(stdin, "isTTY", { value: false });

  await assert.doesNotReject(() => enforceSafety(descriptor, "demo", {
    dryRun: false,
    yes: false,
    nonInteractive: false,
    confirm: "demo",
    environment: "sandbox",
    stdin
  }));
});

test("wrong explicit typed confirmation fails before prompting", async () => {
  const descriptor = findDescriptor("fixture destroy");
  assert.ok(descriptor);

  await assert.rejects(
    () => enforceSafety(descriptor, "demo", {
      dryRun: false,
      yes: false,
      nonInteractive: false,
      confirm: "wrong",
      environment: "sandbox"
    }),
    /Confirmation does not match/
  );
});
