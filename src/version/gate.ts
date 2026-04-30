import { CURRENT_VERSION } from "./current.js";
import { compareSemver } from "./semver.js";

export const LATEST_HEADER = "x-nitrosend-cli-latest";
export const MIN_HEADER = "x-nitrosend-cli-min";

export interface HeaderReader {
  get(name: string): string | null;
}

export interface VersionGateOptions {
  currentVersion?: string;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export class CliVersionError extends Error {
  readonly exitCode = 78;

  constructor(message: string) {
    super(message);
    this.name = "CliVersionError";
  }
}

export class VersionGate {
  private readonly currentVersion: string;
  private readonly stderr: Pick<NodeJS.WriteStream, "write">;
  private warnedForLatest: string | null = null;

  constructor(options: VersionGateOptions = {}) {
    this.currentVersion = options.currentVersion ?? CURRENT_VERSION;
    this.stderr = options.stderr ?? process.stderr;
  }

  check(headers: HeaderReader): void {
    const latest = headers.get(LATEST_HEADER) ?? headers.get("X-Nitrosend-CLI-Latest");
    const minimum = headers.get(MIN_HEADER) ?? headers.get("X-Nitrosend-CLI-Min");

    if (minimum) {
      const minCompare = compareSemver(this.currentVersion, minimum);
      if (minCompare !== null && minCompare < 0) {
        throw new CliVersionError(
          `Nitrosend CLI ${this.currentVersion} is no longer supported; install @nitrosend/cli@latest (minimum ${minimum}).`
        );
      }
    }

    if (latest && latest !== this.warnedForLatest) {
      const latestCompare = compareSemver(this.currentVersion, latest);
      if (latestCompare !== null && latestCompare < 0) {
        this.stderr.write(
          `Nitrosend CLI update available: ${this.currentVersion} -> ${latest}. Run npm install -g @nitrosend/cli@latest.\n`
        );
        this.warnedForLatest = latest;
      }
    }
  }
}

export const versionGate = new VersionGate();
