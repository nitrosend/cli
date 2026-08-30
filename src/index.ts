#!/usr/bin/env node

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (argv.length === 1 && argv[0] === "--help") {
  process.stdout.write(readFileSync(new URL("./runtime/help.txt", import.meta.url), "utf8"));
  process.exitCode = 0;
} else if (argv.length === 1 && argv[0] === "--version") {
  const { CURRENT_VERSION } = await import("./version/current.js");
  process.stdout.write(`${CURRENT_VERSION}\n`);
  process.exitCode = 0;
} else {
  const { runCli } = await import("./cli.js");
  process.exitCode = await runCli({ argv });
}
