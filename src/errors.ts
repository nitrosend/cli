export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = "CliError";
  }
}

export function isCliError(error: unknown): error is CliError | { message: string; exitCode: number } {
  return error instanceof Error && "exitCode" in error && typeof (error as { exitCode: unknown }).exitCode === "number";
}
