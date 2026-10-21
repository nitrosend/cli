import { writeFile } from "node:fs/promises";

import { COMMAND_DESCRIPTORS, FLAG_ALIASES, GLOBAL_OPTIONS } from "../dist/contracts/descriptors.js";
import { CURRENT_VERSION } from "../dist/version/current.js";

// The published command contract, for tools such as the docs site's command
// reference that need every descriptor without running the CLI.
const output = new URL("../dist/descriptors.json", import.meta.url);
const contract = {
  version: CURRENT_VERSION,
  commands: COMMAND_DESCRIPTORS,
  global_options: GLOBAL_OPTIONS,
  flag_aliases: FLAG_ALIASES
};
await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
