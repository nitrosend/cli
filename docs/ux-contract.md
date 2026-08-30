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

### HTTP response classification

All networked commands use the shared HTTP transport. The transport classifies
connection failures, HTTP failures, and malformed bodies before command-specific
parsing runs:

- Network/DNS/timeout failures use `69` with `code: "network_error"`.
- HTTP `401`/`403` use `77` with `code: "authentication_failed"`, even when the
  response body is plain text rather than JSON.
- HTTP `2xx` with a non-JSON body uses `65` with
  `code: "invalid_json_response"`.
- Other HTTP failures use the server JSON error message when present and fall
  back to `code: "http_error"`.

## Safety

Mutating commands declare a safety class and whether they support `--dry-run`.
Commands with an irreversible external effect may require typed confirmation;
destructive commands always do. `--yes` never bypasses typed confirmation.
`--non-interactive` and `--machine` fail closed whenever a prompt would be
required.

`local-state` commands mutate only the user's local Nitrosend CLI files, such as
profile creation/removal. They do not call Nitrosend server-side mutation APIs,
but agents should still treat any credential material as sensitive.

## Agent Mode

`--machine` implies `--json --non-interactive --no-color --no-pager`. Commands
whose descriptor declares automatic idempotency receive a generated key in all
output modes. Callers may pass `--idempotency-key <key>` to make retries stable.
Read commands never receive an idempotency key.
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
nitrosend inbox list --query billing
nitrosend inbox queue --state needs_attention
nitrosend inbox get 123
nitrosend inbox item 456
```

These commands call existing MCP tools internally and keep the same
`CommandResult` envelope as raw MCP commands.

## First-Class Inbox Actions

Inbox mutations remain adapters over the single `nitro_inbox_action` tool:

```bash
nitrosend inbox reply 123 --body 'Draft reply' --dry-run
nitrosend inbox reply 123 --body 'Send this' --confirm 123
nitrosend inbox reply 123 --body 'Test this' --test-to me@example.com --confirm 123
nitrosend inbox action 456 mark-handled
```

The reply adapter first reads the current bounded thread context and forwards
its server-issued reply-context digest. It does not recreate reply policy in the
CLI. Real and test sends require typed confirmation. Disposition actions are
idempotent state mutations and accept the same generated or caller-supplied
idempotency key contract.

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
prints timing diagnostics to stderr and adds `meta.trace` to JSON envelopes.
Trace events include request URL, method, response status, selected response
headers, and the first 200 characters of the response body only for failed or
non-JSON responses. Spinners may appear only after 300ms and never in machine
output.
