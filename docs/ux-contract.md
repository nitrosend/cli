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

## Safety

Mutating commands declare a safety class and whether they support `--dry-run`.
Destructive commands use typed confirmation, not `y/N`. `--yes` never bypasses a
typed confirmation. `--non-interactive` and `--machine` fail closed whenever a
prompt would be required.

## Agent Mode

`--machine` implies `--json --non-interactive --no-color --no-pager`. Commands
with side effects receive an automatic idempotency key when applicable.
`--explain` returns the resolved plan as data without performing side effects.

Approval handoff commands are reserved as stable stubs:

```bash
nitrosend approve <token>
nitrosend reject <token>
```

## Project Context

The CLI walks up from the current working directory looking for
`.nitrosend.yml`. This file may define profile, output, API URL, and environment
defaults. It must never contain secrets. Environment labels are shown on command
results, and destructive production targets require an extra typed confirmation.

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
