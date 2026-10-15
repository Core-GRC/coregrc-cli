# Developing the Core GRC CLI

Published to npm as [`coregrc`](https://www.npmjs.com/package/coregrc). `files` in `package.json` ships only `bin`, `src`, `README.md`, and `LICENSE`. `README.md` is the npm page; the full customer docs are at https://core-grc.com/claude/cli.

## Run from the repo

Requires Node.js 22 or later. There are no dependencies to install.

```bash
npm link          # puts coregrc on your PATH
npm test
node bin/coregrc.js --help   # without linking
```

## Point at another server

The CLI talks to production by default. To use a different Core GRC environment, set all three URLs before signing in:

```bash
export COREGRC_APP_ORIGIN="https://<app-origin>"
export COREGRC_MCP_URL="https://<server>/mcpHttp"
export COREGRC_OAUTH_URL="https://<server>/mcpOauthHttp"
export COREGRC_CREDENTIALS="$HOME/.config/coregrc/credentials-<env>.json"
coregrc login
```

A separate `COREGRC_CREDENTIALS` file keeps that sign-in apart from your production one.

## How it works

- `login` uses OAuth with PKCE, `client_id` `coregrc-cli`, scope `core-grc`, and a loopback redirect on `127.0.0.1:8788`–`8798`. The server recognises a redirect on that port range as the CLI, which lists the CLI-only tools and saves changes with source `cli`. Don't change the port range without a matching server change.
- Every command sends `initialize`, `notifications/initialized`, and `MCP-Protocol-Version` before `tools/list` or `tools/call`. `clientInfo.version` comes from `package.json`.
- The access token is refreshed a minute before it expires and once more on a `401`.
- Module commands call `<module>_<action>` directly, so new server tools need no CLI change. The server resolves aliases such as `tprm_dashboard`. `tools/list` is only fetched when the server says the name is unknown, to tell a wrong module from a wrong action.
- Some tools are only listed for CLI sign-ins.

## Publish

Releases publish from GitHub Actions with npm trusted publishing, so there is no npm token to manage, and each version carries provenance.

1. Bump `version` in `package.json` and commit.
2. `npm test` and `npm pack --dry-run`. Check only `bin`, `src`, `README.md`, `LICENSE`, and `package.json` are included.
3. Create a GitHub release with the tag `v<version>`, for example `v1.0.1`. The `Publish` workflow checks the tag matches `package.json`, runs the tests, and publishes.
4. Update https://core-grc.com/claude/cli if commands or behaviour changed.

## Contributing

Report bugs through GitHub Issues. Report security problems as described in [SECURITY.md](SECURITY.md), not in a public issue.
