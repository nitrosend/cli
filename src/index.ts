#!/usr/bin/env node

import { runCli } from "./cli.js";

const exitCode = await runCli({ argv: process.argv.slice(2) });
process.exitCode = exitCode;
