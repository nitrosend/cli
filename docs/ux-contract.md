# Nitrosend CLI UX Contract

The CLI uses a contract-first runtime:

```text
CommandDescriptor -> CommandResult / CommandError -> renderer
```

Every implemented command has a `CommandDescriptor` with input schema, output
schema, examples, safety class, dry-run support, cache policy, idempotency
policy, and agent suitability.

## Output

Machine output uses `schema_version: 1`. JSON stdout is sacred: no spinners,
warnings, prompts, traces, upgrade notices, or color codes may appear on stdout
for `--json`, `--ndjson`, or `--machine`.

Supported output modes:

- TTY: default human output.
- JSON: stable success/error envelopes.
- NDJSON: one stable stream event per line.
- CSV: table data only.

## Exit Codes

- `0`: success
- `64`: usage error
- `65`: data or validation error
- `69`: service unavailable
- `70`: internal error
- `75`: temporary or retriable failure
- `77`: permission or auth failure
- `78`: unsupported or outdated CLI

### MCP error envelopes

Some MCP failures arrive as successful JSON-RPC `result` payloads, not as
JSON-RPC `error` payloads. The CLI treats `tools/call` results with
`isError: true` and `resources/read` text envelopes containing `"error": true`
as command failures. Inline MCP codes map through the normal exit-code contract:
`not_found` and validation-like failures use `65`, `unavailable` uses `69`,
temporary failures use `75`, permission/auth failures use `77`, and
`unsupported` uses `78`.

## Safety

Mutating commands declare a safety class and whether they support `--dry-run`.
Destructive commands use typed confirmation, not `y/N`. `--yes` never bypasses a
typed confirmation. `--non-interactive` and `--machine` fail closed whenever a
prompt would be required.

## Agent Mode

`--machine` implies `--json --non-interactive --no-color --no-pager`. Commands
with side effects receive an automatic idempotency key when applicable; read
commands do not receive one just because `--machine` is set.
`--explain` returns the resolved plan as data without performing side effects.
For `mcp tools call <name>`, explain first uses cached `tools/list`
annotations to report wrapped-tool safety and falls back to conservative
name-pattern inference only when annotations are unavailable.

Approval handoff commands are reserved as stable stubs:

```bash
nitrosend approve <token>
nitrosend reject <token>
```

## First-Class Reads

The CLI exposes common read workflows without requiring raw MCP JSON:

```bash
nitrosend status
nitrosend flows list --status draft --per 10
nitrosend campaigns list --search welcome
nitrosend contacts list --query alice@example.com
nitrosend lists list
nitrosend templates list
```

These commands call existing MCP tools internally and keep the same
`CommandResult` envelope as raw MCP commands.

## Release Guidance

`nitrosend --version` stays a raw version string for scripts. `nitrosend version`
provides structured package and Node runtime details. `nitrosend update` checks
the npm registry and returns `up_to_date`, `update_available`, or `unknown`.

## Project Context

The CLI walks up from the current working directory looking for
`.nitrosend.yml`. This file may define profile, output, API URL, and environment
defaults. It must never contain secrets. Non-default environment labels are
shown on command results, and destructive production targets require an extra
typed confirmation.

Example:

```yaml
profile: sandbox
environment: sandbox
output: json
```

## Performance Budget

Help, version, and cached status paths are expected to stay fast. `--trace`
prints timing diagnostics to stderr. Spinners may appear only after 300ms and
never in machine output.
