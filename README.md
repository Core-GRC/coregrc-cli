# coregrc

The Core GRC command line. Run Core GRC tools for third-party risk management, privacy policies and notices, cookie consent, privacy rights, and website accessibility from your terminal, with the permissions you already have in Core GRC.

Full documentation: https://core-grc.com/docs/cli

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
coregrc tprm add-template-mapping '{"templateId":"<id>","questionId":"q1","kind":"risk","answerValue":"No","title":"No MFA","description":"MFA is not enforced"}'
```

Deleting, archiving, cancelling, restoring, publishing, starting a cookie scan, and using a paid licence need `"confirm": true` in the arguments.

### Incidents

```bash
coregrc tprm list-incidents '{"open":true}'
coregrc tprm create-incident '{"fields":{"title":"Vendor outage","description":"Payroll vendor down for 4 hours","category":"Third party","severity":"High","awareAt":"2026-11-20T09:00:00Z","affected":{"vendors":["<vendor-id>"]}}}'
coregrc tprm list-regulatory-presets
coregrc tprm upsert-incident-notification '{"id":"<incident-id>","notification":{"presetId":"gdpr-controller","stageKey":"notification"}}'
coregrc tprm archive-incident '{"id":"<incident-id>","confirm":true}'
```

Regulator deadlines are worked out from the cited rules to help you track them. They are not legal advice.

The old AI incident commands (`tprm list-ai-incidents`, `get-ai-incident`, `create-ai-incident`, `update-ai-incident` and `delete-ai-incident`) have been removed, not aliased, and now return `Unknown tool`. Use the incident commands above with category `AI` and the AI system in `affected.aiSystems`. Existing AI incidents were moved into the incident register.

### AI Governance

```bash
coregrc tprm list-ai-framework-items '{"function":"GOVERN","gapOnly":true}'
coregrc tprm get-ai-scorecard '{"aiSystemId":"<id>"}'
coregrc tprm update-ai-scorecard '{"aiSystemId":"<id>","rowKey":"fairBiasManaged","fields":{"status":"Assessed"}}'
coregrc tprm set-ai-impact-tier '{"aiSystemId":"<id>","tier":"High","reason":"Makes hiring decisions"}'
coregrc tprm list-intake-submissions
```

### Vendor governance and exports

```bash
coregrc tprm list-vendor-contracts '{"vendorId":"<vendor-id>"}'
coregrc tprm create-vendor-contract '{"vendorId":"<vendor-id>","fields":{"name":"Master services agreement","status":"Active","endDate":"2027-06-30","noticePeriodDays":90}}'
coregrc tprm record-vendor-review '{"vendorId":"<vendor-id>","notes":"SOC 2 report checked"}'
coregrc tprm export-dora-register > dora-register.json
coregrc tprm export-ropa > ropa.json
```

The DORA export is a starting point to check and complete, not a filing. The RoPA export gives your GDPR Article 30 records as CSV text.

### Register reviews, tags and history

```bash
coregrc tprm get-register-governance '{"entityType":"asset","entityId":"<id>"}'
coregrc tprm record-register-review '{"entityType":"asset","entityId":"<id>","notes":"Owner confirmed"}'
coregrc tprm update-risk '{"id":"<risk-id>","fields":{"tags":["payments"],"csfCategories":["GV.SC"]}}'
coregrc tprm list-issues '{"tag":"payments"}'
coregrc tprm get-record-history '{"recordType":"incident","recordId":"<id>"}'
```

Tag lists replace what is there. List tools take one tag filter per call: `tag`, `csfCategory`, `gaiRisk` or `trustworthinessCharacteristic`.

### Bulk tools

Tools with `bulk` in the name work on a list of records in one command, such as `tprm bulk-create-entities`, `tprm bulk-update-entities`, `tprm bulk-update-risks` and `tprm bulk-archive-entities`. Run `coregrc tools | grep bulk` to see them all.

```bash
coregrc tprm bulk-update-entities @vendor-owners.json
```

```json
{
  "entityType": "vendor",
  "items": [
    { "id": "<id-1>", "fields": { "owner": "priya@example.com" } },
    { "id": "<id-2>", "fields": { "owner": "sam@example.com" } }
  ]
}
```

A bulk tool takes up to 50 records per call, or 10 for assessment jobs and workflow runs. Pass a longer list and the CLI sends it in batches, shows progress on stderr, and prints one merged result. One bad record doesn't stop the rest, and a result with failed records still exits 0, so check `failedCount` and `failed`. `index` is the record's position in your list. If a whole batch is refused, the CLI stops, exits 1, and lists the records it never sent in `notAttempted`. If a request fails before a reply arrives (a network or server error), the CLI also stops and exits 1, keeps the results of earlier batches, and lists that batch's records in `unconfirmed`: they may already have been applied, so check them before sending them again. Archiving in bulk needs `"confirm": true`; there is no bulk delete.

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
| `COREGRC_MCP_URL` | `https://cli.core-grc.com/mcpHttp` |
| `COREGRC_OAUTH_URL` | `https://cli.core-grc.com/mcpOauthHttp` |

Use a different `COREGRC_CREDENTIALS` file per organization to stay signed in to several. The credentials file is created readable only by you; don't share or commit it.

## Support

support@core-grc.com. Report bugs in [GitHub Issues](https://github.com/Core-GRC/coregrc-cli/issues) and security problems as described under "Report a vulnerability" on the [Security page](https://core-grc.com/security).

## Licence

MIT. See [LICENSE](LICENSE).
