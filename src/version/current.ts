import { createRequire } from "node:module";

type PackageManifest = Readonly<{ version: string }>;

const require = createRequire(import.meta.url);
const manifest = require("../../package.json") as PackageManifest;

export const CURRENT_VERSION = manifest.version;
