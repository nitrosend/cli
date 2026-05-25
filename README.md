# @nitrosend/cli

The Nitrosend command-line interface. Send email and SMS, run flows and campaigns, query contacts, and inspect account state — from your terminal or a CI pipeline.

All plans, including free plans, have full access to Nitrosend MCP/API/CLI. The CLI is not a paid-plan feature; plan limits apply to usage volume and paid add-ons.

```bash
npm install -g @nitrosend/cli
nitrosend login
nitrosend
```

Requires Node.js 18+.

## Quick start

```bash
nitrosend login            # browser-based OAuth (recommended)
nitrosend                  # dashboard: account state, blockers, next actions
nitrosend status           # account health, onboarding, billing
nitrosend flows list       # your flows
nitrosend campaigns list   # your campaigns
```

Add `--json` to any command for a machine-readable envelope. `nitrosend describe <command>` returns the full input/output schema for any command.

## What you can do

### Inspect

```bash
nitrosend whoami                # active profile + endpoint
nitrosend status                # live account, billing, preflight checks
nitrosend flows list            # --status --search --page --per
nitrosend campaigns list
nitrosend contacts list         # --query --list-id
nitrosend lists list
nitrosend templates list
```

### Send and automate

The CLI exposes the full Nitrosend MCP surface — every tool an AI agent can call, you can call too:

```bash
nitrosend mcp tools list
nitrosend mcp tools call nitro_send_message --args '{...}'
nitrosend mcp tools call nitro_compose_campaign --args '{...}'
nitrosend mcp tools call nitro_get_status --args '{"include":["account"]}'
```

Resources and prompts work the same way:

```bash
nitrosend mcp resources list
nitrosend mcp resources read nitro://account
nitrosend mcp prompts list
nitrosend mcp prompts get build-email --args '{"goal":"welcome series"}'
```

### Inspect, plan, and replay

```bash
nitrosend describe campaigns list   # schema + examples + safety class
nitrosend recent                    # redacted history
nitrosend redo 1                    # re-run a previous command
nitrosend redo 1 --explain          # show the resolved plan, don't execute
nitrosend <any-command> --dry-run   # preview without persisting (where supported)
```

## Authentication

OAuth (browser-based) is the default:

```bash
nitrosend login
```

For CI or headless environments, use an API key — either as an environment variable (nothing written to disk):

```bash
export NITROSEND_API_KEY=nskey_live_...
nitrosend status
```

…or stored in a local profile:

```bash
nitrosend login --api-key nskey_live_...
```

`NITROSEND_BEARER_TOKEN` and `NITROSEND_API_KEY` always take precedence over stored profiles. `nitrosend logout` removes the active profile.

Profiles live under your platform config directory (or `NITROSEND_CONFIG_DIR` if set), with directory permissions locked to your user. On shared machines, prefer the env-var form.

## Output and scripting

Every command returns the same envelope under `--json`:

```json
{
  "schema_version": 1,
  "ok": true,
  "command": "flows list",
  "data": { "rows": [ ... ] },
  "meta": { "duration_ms": 142, "environment": "production" },
  "presentation": { "type": "table" }
}
```

Errors return `ok: false` with a structured `error` object (`code`, `message`, `retriable`).

Useful flags:

| Flag | Effect |
|------|--------|
| `--json`, `--ndjson`, `--csv` | Output mode |
| `--machine` | Implies `--json --non-interactive --no-color --no-pager` |
| `--explain` | Print the resolved plan; don't execute |
| `--dry-run` | Preview changes without persisting (where supported) |
| `--yes` | Skip non-destructive confirmations (typed confirmation still required for destructive ops) |
| `--non-interactive` | Fail closed when input would be required |
| `--trace` | Write a structured trace to stderr |

JSON stdout is sacred: no spinners, prompts, or upgrade notices ever land there. Anything advisory goes to stderr.

### Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `64` | Usage error |
| `65` | Validation or data error |
| `69` | Service unavailable / network error |
| `70` | Internal error |
| `75` | Temporary, retriable failure |
| `77` | Authentication or permission error |
| `78` | Unsupported / outdated CLI |

See [`docs/ux-contract.md`](docs/ux-contract.md) for the full UX contract.

## Configuration

Project-level defaults can live in `.nitrosend.yml`:

```yaml
profile: sandbox
environment: sandbox
output: json
```

Environment variables:

| Variable | Purpose |
|----------|---------|
| `NITROSEND_API_KEY` | API key (highest precedence) |
| `NITROSEND_BEARER_TOKEN` | Pre-issued OAuth token |
| `NITROSEND_API_URL` | Override the default endpoint (`https://api.nitrosend.com/mcp`) |
| `NITROSEND_CONFIG_DIR` | Custom profile storage path |

## Shell completion

```bash
nitrosend completion bash >> ~/.bashrc
nitrosend completion zsh > "${fpath[1]}/_nitrosend"
nitrosend completion fish > ~/.config/fish/completions/nitrosend.fish
```

## Upgrades

```bash
nitrosend update                       # show guidance for the installed CLI
npm install -g @nitrosend/cli@latest   # upgrade
```

When the API signals a newer version is available, the CLI prints a one-line stderr notice. When the installed version is below the supported minimum, authenticated commands exit non-zero before running. The CLI does not poll the npm registry.

## Related packages

`@nitrosend/cli` is the user-facing CLI. If you're integrating Nitrosend into an MCP-aware AI host (Claude Desktop, Cursor, etc.), use [`@nitrosend/mcp`](https://www.npmjs.com/package/@nitrosend/mcp) — a stdio bridge that proxies MCP traffic from the host to the Nitrosend HTTP endpoint.

## Issues

Bug reports and feature requests: <https://github.com/nitrosend/cli/issues>.

## Working on the CLI

```bash
npm ci
npm run typecheck
npm test
npm run build
node dist/index.js --help
```
