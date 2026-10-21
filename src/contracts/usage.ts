import { JsonSchemaLike } from "./types.js";

// A command's usage line is its input contract. This reads it once so the
// parser, the known-flag check, `describe` and generated docs all agree:
//
//   --flag <value>    a flag that takes a value (`<a|b>` or `a|b` lists the values)
//   --flag            a boolean flag
//   <name>, name      a positional argument (`<a|b>` lists its values)
//   [ ... ]           optional
//   ( a | b )         exactly one of the alternatives

export interface UsageFlag {
  name: string;
  type: "boolean" | "string";
  values?: string[];
  placeholder?: string;
  description?: string;
}

export interface UsagePositional {
  name: string;
  required: boolean;
  values?: string[];
}

export interface UsageSpec {
  flags: UsageFlag[];
  positionals: UsagePositional[];
  required: string[];
  oneOf: string[][];
}

type Node =
  | { kind: "flag"; flag: UsageFlag }
  | { kind: "positional"; name: string; values?: string[] }
  | { kind: "group"; optional: boolean; alternatives: Node[][] };

export function parseUsage(usage: string, commandName: string): UsageSpec {
  const tokens = tokenize(usage);
  const words = commandName ? commandName.split(" ") : [];
  if (tokens[0] !== "nitrosend" || words.some((word, index) => tokens[index + 1] !== word)) {
    throw new Error(`Usage for ${commandName || "dashboard"} must start with \`nitrosend ${commandName}\`: ${usage}`);
  }
  const reader = new Reader(tokens.slice(words.length + 1), usage);
  const nodes = reader.sequence();
  if (!reader.done()) throw new Error(`Unbalanced usage for ${commandName}: ${usage}`);

  const spec: UsageSpec = { flags: [], positionals: [], required: [], oneOf: [] };
  collect(nodes, spec, true);
  return spec;
}

export function usageInputSchema(spec: UsageSpec): JsonSchemaLike {
  const flags: JsonSchemaLike = {
    type: "object",
    properties: Object.fromEntries(spec.flags.map((flag) => [flag.name, flagSchema(flag)]))
  };
  if (spec.required.length > 0) flags.required = spec.required;
  if (spec.oneOf.length > 0) flags.oneOf = spec.oneOf.map((required) => ({ required }));

  const schema: JsonSchemaLike = { type: "object", properties: { flags } };
  if (spec.positionals.length > 0) {
    const positionals: JsonSchemaLike = {
      type: "array",
      prefixItems: spec.positionals.map((positional) => ({
        type: "string",
        description: positional.name,
        ...(positional.values ? { enum: positional.values } : {})
      }))
    };
    const minItems = spec.positionals.filter((positional) => positional.required).length;
    if (minItems > 0) positionals.minItems = minItems;
    (schema.properties as Record<string, unknown>).positionals = positionals;
  }
  return schema;
}

function flagSchema(flag: UsageFlag): JsonSchemaLike {
  if (flag.type === "boolean") return { type: "boolean" };
  return {
    type: "string",
    ...(flag.values ? { enum: flag.values } : {}),
    ...(flag.placeholder ? { description: flag.placeholder } : {})
  };
}

function collect(nodes: Node[], spec: UsageSpec, required: boolean): void {
  for (const node of nodes) {
    if (node.kind === "flag") {
      addFlag(spec, node.flag);
      if (required) spec.required.push(node.flag.name);
    } else if (node.kind === "positional") {
      spec.positionals.push({ name: node.name, required, ...(node.values ? { values: node.values } : {}) });
    } else if (node.alternatives.length === 1) {
      collect(node.alternatives[0], spec, required && !node.optional);
    } else {
      for (const alternative of node.alternatives) {
        const before = spec.required.length;
        collect(alternative, spec, true);
        const chosen = spec.required.splice(before);
        if (required && !node.optional && chosen.length > 0) spec.oneOf.push(chosen);
      }
    }
  }
}

function addFlag(spec: UsageSpec, flag: UsageFlag): void {
  const existing = spec.flags.find((candidate) => candidate.name === flag.name);
  if (!existing) {
    spec.flags.push(flag);
  } else if (existing.type !== flag.type) {
    throw new Error(`--${flag.name} is both a boolean and a value flag in one usage`);
  }
}

class Reader {
  private index = 0;

  constructor(private readonly tokens: string[], private readonly usage: string) {}

  done(): boolean {
    return this.index >= this.tokens.length;
  }

  sequence(): Node[] {
    const nodes: Node[] = [];
    while (!this.done()) {
      const token = this.tokens[this.index];
      if (token === "]" || token === ")" || token === "|") break;
      nodes.push(this.item());
    }
    return nodes;
  }

  private item(): Node {
    const token = this.tokens[this.index++];
    if (token === "[" || token === "(") {
      const close = token === "[" ? "]" : ")";
      const alternatives = [this.sequence()];
      while (this.tokens[this.index] === "|") {
        this.index++;
        alternatives.push(this.sequence());
      }
      if (this.tokens[this.index++] !== close) throw new Error(`Expected ${close} in usage: ${this.usage}`);
      return { kind: "group", optional: token === "[", alternatives };
    }
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const value = this.tokens[this.index];
      if (value === undefined || value.startsWith("--") || ["[", "]", "(", ")", "|"].includes(value)) {
        return { kind: "flag", flag: { name, type: "boolean" } };
      }
      this.index++;
      const values = this.valueList(value);
      return {
        kind: "flag",
        flag: { name, type: "string", placeholder: value, ...(values ? { values } : {}) }
      };
    }
    const values = enumerated(token);
    return { kind: "positional", name: token.replace(/^<|>$/g, ""), ...(values ? { values } : {}) };
  }

  // `--channel email|sms` lists values with bare words; `|--html` starts an alternative.
  private valueList(first: string): string[] | undefined {
    const listed = enumerated(first);
    if (listed || first.startsWith("<") || first.startsWith("'")) return listed;
    const values = [first];
    while (this.tokens[this.index] === "|" && isBareWord(this.tokens[this.index + 1])) {
      values.push(this.tokens[this.index + 1]);
      this.index += 2;
    }
    return values.length > 1 ? values : undefined;
  }
}

function enumerated(token: string): string[] | undefined {
  const inner = token.startsWith("<") && token.endsWith(">") ? token.slice(1, -1) : undefined;
  return inner?.includes("|") ? inner.split("|") : undefined;
}

function isBareWord(token: string | undefined): token is string {
  return token !== undefined && !token.startsWith("-") && !token.startsWith("<") && !["[", "]", "(", ")", "|"].includes(token);
}

function tokenize(usage: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < usage.length) {
    const char = usage[index];
    if (/\s/.test(char)) {
      index++;
    } else if ("[]()|".includes(char)) {
      tokens.push(char);
      index++;
    } else if (char === "<" || char === "'") {
      const close = usage.indexOf(char === "<" ? ">" : "'", index + 1);
      if (close < 0) throw new Error(`Unclosed ${char} in usage: ${usage}`);
      tokens.push(usage.slice(index, close + 1));
      index = close + 1;
    } else {
      const start = index;
      while (index < usage.length && !/\s/.test(usage[index]) && !"[]()|<'".includes(usage[index])) index++;
      tokens.push(usage.slice(start, index));
    }
  }
  return tokens;
}
