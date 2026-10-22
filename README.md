# coregrc

The Core GRC command line. Run Core GRC tools for third-party risk management, privacy policies and notices, cookie consent, privacy rights, and website accessibility from your terminal, with the permissions you already have in Core GRC.

Full documentation: https://core-grc.com/claude/cli

## Install

Requires Node.js 22 or later.

```bash
npm install -g coregrc
coregrc --version
```

## Sign in

```bash
coregrc login
```

Your browser opens on Core GRC. Pick an organization under **Choose an organization to continue**, then choose **Allow access**. If the browser doesn't open, use the link the CLI prints. The CLI receives the sign-in at `http://127.0.0.1:8788/callback` (or the next free port up to 8798) and waits five minutes.

Each sign-in is for one organization. `coregrc logout` revokes it and deletes the stored credentials.

Over SSH, forward the port first (`ssh -L 8788:127.0.0.1:8788 you@server`) and open the printed link locally.

## Use

```bash
coregrc whoami                      # your user, role, organization, and active modules
coregrc tools                       # every tool you can use
coregrc tools --module rights       # one module's tools
coregrc describe tprm_list_entities # a tool's input schema
coregrc tprm list-entities '{"entityType":"vendor"}'
coregrc call tprm_list_entities '{"entityType":"vendor"}'
```

Modules are `tprm`, `policy`, `consent`, `rights`, and `webaccess`. You only see modules your organization has active and the tools your role allows. The action is the rest of the tool name in kebab-case or as separate words, and arguments are one JSON object at the end. Put `@file.json` there instead to read the arguments from a file, or `@-` to read them from stdin:

```bash
coregrc tprm create-template @supplier-security.json
```

Deleting, archiving, cancelling, restoring, publishing, starting a cookie scan, and using a paid licence need `"confirm": true` in the arguments.

## Output

Results print to stdout as JSON. A failed tool call prints `{"success": false, "error": "..."}` and exits 1. Errors before the call, such as not being signed in, print to stderr and exit 1.

```bash
coregrc tprm list-entities '{"entityType":"vendor","pageSize":100}' | jq -r '.items[].name'
```

## Environment variables

| Variable | Default |
| --- | --- |
| `COREGRC_CREDENTIALS` | `~/.config/coregrc/credentials.json` |
| `COREGRC_APP_ORIGIN` | `https://app.core-grc.com` |
| `COREGRC_MCP_URL` | `https://mcp.core-grc.com/mcpHttp` |
| `COREGRC_OAUTH_URL` | `https://mcp.core-grc.com/mcpOauthHttp` |

Use a different `COREGRC_CREDENTIALS` file per organization to stay signed in to several. The credentials file is created readable only by you; don't share or commit it.

## Support

support@core-grc.com. Report bugs in [GitHub Issues](https://github.com/Core-GRC/coregrc-cli/issues) and security problems as described in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).
