import { mkdir, writeFile } from "node:fs/promises";

import { helpText } from "../dist/runtime/help.js";

const output = new URL("../dist/runtime/help.txt", import.meta.url);
await mkdir(new URL("../dist/runtime/", import.meta.url), { recursive: true });
await writeFile(output, helpText(), "utf8");
