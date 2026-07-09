import { CommandDescriptor } from "./types.js";

const objectSchema = { type: "object", additionalProperties: true };
const emptySchema = { type: "object", properties: {}, additionalProperties: false };

export const COMMAND_DESCRIPTORS: CommandDescriptor[] = [
  {
    name: "dashboard",
    aliases: [""],
    group: "core",
    summary: "Show local profile state, cached account state, blockers, and suggested next actions.",
    usage: "nitrosend",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show the dashboard", command: "nitrosend" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "read-through", ttl_seconds: 300 },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "login",
    group: "auth",
    summary: "Store an API-key profile, or start browser OAuth when no API key is provided.",
    usage: "nitrosend login [--api-key <key>] [--no-browser] [--api-url <url>] [--profile <name>]",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [
      { description: "Log in with API key", command: "nitrosend login --api-key nskey_test_..." },
      { description: "Start browser OAuth login", command: "nitrosend login" }
    ],
    safety: { class: "local-state", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true, reason: "Use --api-key for non-interactive login. Browser OAuth login is human-facing." }
  },
  {
    name: "logout",
    group: "auth",
    summary: "Remove the active local profile.",
    usage: "nitrosend logout",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Log out", command: "nitrosend logout" }],
    safety: { class: "local-state", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "whoami",
    group: "auth",
    summary: "Show active auth source, profile, and API endpoint.",
    usage: "nitrosend whoami [--json]",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show profile", command: "nitrosend whoami" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
	  {
	    name: "status",
    group: "core",
    summary: "Show live authenticated account health, onboarding state, and next actions.",
    usage: "nitrosend status [--json]",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show account status", command: "nitrosend status" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "read-through", ttl_seconds: 300 },
    idempotency: { mode: "none" },
	    agent: { suitable: true }
	  },
  {
    name: "contacts import",
    group: "contacts",
    summary: "Direct-upload a CSV file and create a contact import.",
    usage: "nitrosend contacts import <file> --list-id <id> [--json]",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Import contacts into a list", command: "nitrosend contacts import ./contacts.csv --list-id 88" }],
    safety: { class: "mutating", supports_dry_run: true, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
	  ...entityListDescriptors(),
  ...inboxDescriptors(),
  {
    name: "describe",
    group: "core",
    summary: "Return descriptor, schemas, examples, and safety metadata for a command.",
    usage: "nitrosend describe <command> [--json]",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Describe a command", command: "nitrosend describe mcp tools list --json" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "completion",
    group: "core",
    summary: "Generate shell completion for bash, zsh, or fish.",
    usage: "nitrosend completion <bash|zsh|fish>",
    input_schema: objectSchema,
    output_schema: { type: "string" },
    examples: [{ description: "Generate zsh completion", command: "nitrosend completion zsh" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "recent",
    group: "core",
    summary: "Show redacted recent commands.",
    usage: "nitrosend recent [--json]",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show history", command: "nitrosend recent" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "redo",
    group: "core",
    summary: "Show or re-run a recent command.",
    usage: "nitrosend redo [index] [--explain]",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Explain last command", command: "nitrosend redo 1 --explain" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "version",
    group: "release",
    summary: "Show CLI version and runtime details.",
    usage: "nitrosend version [--json]",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show version details", command: "nitrosend version --json" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  {
    name: "update",
    group: "release",
    summary: "Show update guidance for the installed CLI.",
    usage: "nitrosend update [--json]",
    input_schema: emptySchema,
    output_schema: objectSchema,
    examples: [{ description: "Show update command", command: "nitrosend update" }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "none" },
    agent: { suitable: true }
  },
  ...mcpDescriptors(),
  {
    name: "fixture destroy",
    group: "fixtures",
    summary: "Exercise destructive safety UX without touching live Nitrosend data.",
    usage: "nitrosend fixture destroy <name> --confirm <name>",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Preview fixture destruction", command: "nitrosend fixture destroy demo --dry-run" }],
    safety: {
      class: "destructive",
      supports_dry_run: true,
      requires_confirmation: true,
      confirmation_target: "<name>"
    },
    cache: { mode: "none" },
    idempotency: { mode: "auto" },
    agent: { suitable: true, reason: "Safe fixture command used to validate safety behavior." }
  },
  {
    name: "approve",
    group: "agent",
    summary: "Approve a pending agent operation token.",
    usage: "nitrosend approve <token>",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Approve a token", command: "nitrosend approve tok_..." }],
    safety: { class: "external-effect", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "auto" },
    agent: { suitable: true }
  },
  {
    name: "reject",
    group: "agent",
    summary: "Reject a pending agent operation token.",
    usage: "nitrosend reject <token>",
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: "Reject a token", command: "nitrosend reject tok_..." }],
    safety: { class: "external-effect", supports_dry_run: false, requires_confirmation: false },
    cache: { mode: "none" },
    idempotency: { mode: "auto" },
    agent: { suitable: true }
  }
];

export function findDescriptor(commandName: string): CommandDescriptor | undefined {
  return COMMAND_DESCRIPTORS.find((descriptor) => {
    return descriptor.name === commandName || descriptor.aliases?.includes(commandName);
  });
}

export function commandNames(): string[] {
  return COMMAND_DESCRIPTORS.map((descriptor) => descriptor.name).filter(Boolean).sort();
}

function mcpDescriptors(): CommandDescriptor[] {
  const base = {
    group: "mcp",
    input_schema: objectSchema,
    output_schema: objectSchema,
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false } as const,
    cache: { mode: "none" as const },
    idempotency: { mode: "none" as const },
    agent: { suitable: true }
  };

  return [
    ["mcp initialize", "Initialize MCP handshake.", "nitrosend mcp initialize [--json]"],
    ["mcp tools list", "List MCP tools.", "nitrosend mcp tools list [--json]"],
    ["mcp tools call", "Call an MCP tool.", "nitrosend mcp tools call <name> --args '{...}'"],
    ["mcp resources list", "List MCP resources.", "nitrosend mcp resources list [--json]"],
    ["mcp resources read", "Read an MCP resource.", "nitrosend mcp resources read <uri>"],
    ["mcp prompts list", "List MCP prompts.", "nitrosend mcp prompts list [--json]"],
    ["mcp prompts get", "Get an MCP prompt.", "nitrosend mcp prompts get <name> --args '{...}'"]
  ].map(([name, summary, usage]) => {
    const descriptor = {
      ...base,
      name,
      summary,
      usage,
      examples: [{ description: summary, command: usage.replace(" [--json]", "") }]
    };

    if (name === "mcp tools call") {
      return {
        ...descriptor,
        safety: { class: "external-effect", supports_dry_run: false, requires_confirmation: false } as const,
        agent: {
          suitable: true,
          reason: "Proxy command. Use --explain with a tool name to inspect inferred wrapped-tool safety."
        }
      };
    }

    return descriptor;
  });
}

function entityListDescriptors(): CommandDescriptor[] {
  return [
    ["flows list", "List flows.", "nitrosend flows list [--status <status>] [--search <text>] [--page <n>] [--per <n>]", "nitrosend flows list --status draft --per 10"],
    ["campaigns list", "List campaigns.", "nitrosend campaigns list [--status <status>] [--search <text>] [--page <n>] [--per <n>]", "nitrosend campaigns list --status draft --per 10"],
    ["contacts list", "List contacts.", "nitrosend contacts list [--query <text>] [--list-id <id>] [--page <n>] [--per <n>]", "nitrosend contacts list --query alice --per 10"],
    ["lists list", "List contact lists.", "nitrosend lists list [--search <text>] [--page <n>] [--per <n>]", "nitrosend lists list --search newsletter"],
    ["templates list", "List templates.", "nitrosend templates list [--search <text>] [--page <n>] [--per <n>]", "nitrosend templates list --search welcome"],
    ["suppressions list", "List account suppressions with bounce diagnostics.", "nitrosend suppressions list [--email <email>] [--reason <reason>] [--active <true|false>] [--page <n>] [--per <n>]", "nitrosend suppressions list --reason hard_bounce --per 10"]
  ].map(([name, summary, usage, example]) => ({
    name,
    group: "data",
    summary,
    usage,
    input_schema: objectSchema,
    output_schema: objectSchema,
    examples: [{ description: summary, command: example }],
    safety: { class: "read", supports_dry_run: false, requires_confirmation: false } as const,
    cache: { mode: "none" as const },
    idempotency: { mode: "none" as const },
    agent: { suitable: true }
  }));
}

function inboxDescriptors(): CommandDescriptor[] {
  return [
    {
      name: "inbox list",
      group: "inbox",
      summary: "List agent inbox mailbox conversations.",
      usage: "nitrosend inbox list [--query <text>] [--inbox-id <id>] [--status <status>] [--page <n>] [--per <n>]",
      input_schema: objectSchema,
      output_schema: objectSchema,
      examples: [{ description: "Search inbox conversations", command: "nitrosend inbox list --query sourcey --per 10" }],
      safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
      cache: { mode: "none" },
      idempotency: { mode: "none" },
      agent: { suitable: true }
    },
    {
      name: "inbox get",
      group: "inbox",
      summary: "Read one sanitized agent inbox thread.",
      usage: "nitrosend inbox get <conversation-id> [--message-limit <n>]",
      input_schema: objectSchema,
      output_schema: objectSchema,
      examples: [{ description: "Read a thread", command: "nitrosend inbox get 123 --message-limit 10" }],
      safety: { class: "read", supports_dry_run: false, requires_confirmation: false },
      cache: { mode: "none" },
      idempotency: { mode: "none" },
      agent: { suitable: true }
    }
  ];
}
