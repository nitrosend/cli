# Nitrosend CLI

`@nitrosend/cli` is the command-line interface for Nitrosend. This first cut
ships auth/profile handling and raw MCP operations over direct HTTP JSON-RPC.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
node dist/index.js --help
```

## Authentication

Use an API key for CI/headless workflows:

```bash
nitrosend login --api-key nskey_test_...
```

Or keep credentials out of local profile storage and use environment variables:

```bash
export NITROSEND_API_KEY=nskey_test_...
nitrosend mcp tools list
```

OAuth PKCE login is available through the browser:

```bash
nitrosend login
```

Profiles are stored outside the repository under the platform config directory,
or under `NITROSEND_CONFIG_DIR` when that environment variable is set.

## MCP Commands

```bash
nitrosend mcp initialize
nitrosend mcp tools list
nitrosend mcp tools call nitro_get_status --args '{"include":["account"]}'
nitrosend mcp resources list
nitrosend mcp resources read nitro://account
nitrosend mcp prompts list
nitrosend mcp prompts get campaign_brief --args '{"goal":"welcome series"}'
```

Add `--json` to print machine-readable output. Upgrade notices are written only
to stderr so JSON stdout remains parseable.

## UX Contract

The CLI uses descriptor-backed commands and stable `schema_version: 1` output
envelopes. `--machine` implies `--json --non-interactive --no-color --no-pager`.
Use `--explain` to inspect the command plan without performing side effects.

Project defaults can live in `.nitrosend.yml`:

```yaml
profile: sandbox
environment: sandbox
output: json
```

Destructive actions require typed confirmation. `--yes` and non-interactive mode
fail closed when typed confirmation is required. See `docs/ux-contract.md` for
exit codes, dry-run behavior, performance budget, and command descriptor rules.

## CLI Upgrade Notices

Nitrosend API responses may include:

- `X-Nitrosend-CLI-Latest`
- `X-Nitrosend-CLI-Min`

The CLI compares those headers against its own version. If it is behind latest,
it prints a one-line stderr notice once per process. If it is below the minimum,
it exits non-zero before continuing authenticated work. The CLI does not poll
the npm registry for update checks.

## Relationship To `@nitrosend/mcp`

`@nitrosend/mcp` is a stdio bridge for MCP clients. `@nitrosend/cli` talks to
the Nitrosend MCP HTTP endpoint directly and exposes user-facing commands.
