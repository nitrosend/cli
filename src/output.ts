export function printJson(stdout: Pick<NodeJS.WriteStream, "write">, value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printHuman(stdout: Pick<NodeJS.WriteStream, "write">, value: unknown): void {
  if (value === null || value === undefined) {
    stdout.write("OK\n");
    return;
  }

  if (typeof value === "string") {
    stdout.write(`${value}\n`);
    return;
  }

  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
