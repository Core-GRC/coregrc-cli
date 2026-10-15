"use strict";

const { login, logout } = require("./auth");
const {
  listTools,
  callTool,
  printToolResult,
  isUnknownToolResult,
  whoami,
  describeTool,
  fetchToolList,
  assertListedModuleTool,
  CLI_VERSION,
} = require("./mcp");

const RESERVED_COMMANDS = new Set([
  "login",
  "logout",
  "whoami",
  "tools",
  "describe",
  "call",
  "help",
  "--help",
  "-h",
  "version",
  "--version",
  "-v",
]);

function usage() {
  return `coregrc — Core GRC CLI ${CLI_VERSION}

Usage:
  coregrc login                          Sign in through your browser
  coregrc logout                         Revoke this sign-in and delete stored credentials
  coregrc whoami                         Show your organization, role, and active modules
  coregrc tools [--module <prefix>]      List the tools you can use
  coregrc describe <tool-name>           Show a tool's description and input schema
  coregrc call <tool-name> [json-args]   Call any tool by its full name
  coregrc <module> <action> [json-args]  Call a tool by module and action
  coregrc --version                      Print the CLI version

Modules are prefixes from tools/list (tprm, policy, consent, rights, webaccess).
Actions are the rest of the tool name, in kebab-case or as separate words:
  coregrc tprm list-entities '{"entityType":"vendor"}'
  coregrc tprm list entities '{"entityType":"vendor"}'
  coregrc tprm dashboard
  coregrc consent list-websites
  coregrc consent list-cookies '{"websiteId":"..."}'
  coregrc policy get policy '{"id":"..."}'
  coregrc policy delete policy '{"id":"...","confirm":true}'
  coregrc rights list-requests
  coregrc rights get-stats
  coregrc webaccess list-websites
  coregrc webaccess list-scan-issues '{"jobId":"...","limit":10}'

Results print as JSON on stdout. A failed tool call prints {"success":false,"error":...}
and exits 1. Delete, archive, cancel, restore, publish, and paid-licence tools require
confirm:true in the JSON args.

Environment:
  COREGRC_APP_ORIGIN   Central app origin (default https://app.core-grc.com)
  COREGRC_MCP_URL      MCP HTTP URL (overrides the URL stored at login)
  COREGRC_OAUTH_URL    OAuth HTTP URL (overrides the URL stored at login)
  COREGRC_CREDENTIALS  Credentials file (default ~/.config/coregrc/credentials.json)

Docs: https://core-grc.com/claude/cli
`;
}

function parseModuleFlag(argv) {
  const idx = argv.indexOf("--module");
  if (idx >= 0) return argv[idx + 1] || "";
  const flag = argv.find((a) => a.startsWith("--module="));
  return flag ? flag.slice("--module=".length) : "";
}

function looksLikeJsonArg(value) {
  const text = String(value || "").trim();
  return text.startsWith("{") || text.startsWith("[");
}

function splitTokensAndJson(rest) {
  const args = Array.isArray(rest) ? rest.filter((item) => item != null && item !== "") : [];
  if (args.length === 0) return { tokens: [], jsonArgs: undefined };
  const last = args[args.length - 1];
  if (looksLikeJsonArg(last)) {
    return { tokens: args.slice(0, -1), jsonArgs: last };
  }
  return { tokens: args, jsonArgs: undefined };
}

function kebabOrTokensToSuffix(tokens) {
  return tokens
    .flatMap((token) => String(token).split(/[-_]/))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("_");
}

function toolNameFromModuleCommand(moduleName, rest) {
  const { tokens, jsonArgs } = splitTokensAndJson(rest);
  if (tokens.length === 0) {
    throw new Error(`Usage: coregrc ${moduleName} <action> [json-args]`);
  }
  return { name: `${moduleName}_${kebabOrTokensToSuffix(tokens)}`, jsonArgs };
}

function assertNoArgs(cmd, rest) {
  if (rest.length > 0) {
    throw new Error(`coregrc ${cmd} takes no arguments. Run: coregrc --help`);
  }
}

/** `tools` accepts only `--module <prefix>` or `--module=<prefix>`. */
function assertToolsArgs(rest) {
  const ok =
    rest.length === 0 ||
    (rest.length === 2 && rest[0] === "--module" && rest[1] && !rest[1].startsWith("-")) ||
    (rest.length === 1 && /^--module=.+/.test(rest[0]));
  if (!ok) throw new Error("Usage: coregrc tools [--module <prefix>]");
}

async function run(argv, deps = {}) {
  const fetchTools = deps.fetchToolList || fetchToolList;
  const invoke = deps.callTool || callTool;
  const print = deps.printToolResult || printToolResult;
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(usage());
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    assertNoArgs(cmd, rest);
    console.log(CLI_VERSION);
    return;
  }
  if (cmd === "login") {
    assertNoArgs(cmd, rest);
    await (deps.login || login)();
    return;
  }
  if (cmd === "logout") {
    assertNoArgs(cmd, rest);
    await (deps.logout || logout)();
    return;
  }
  if (cmd === "whoami") {
    assertNoArgs(cmd, rest);
    await whoami();
    return;
  }
  if (cmd === "tools") {
    assertToolsArgs(rest);
    await listTools(parseModuleFlag(rest));
    return;
  }
  if (cmd === "describe") {
    if (rest.length !== 1) throw new Error("Usage: coregrc describe <tool-name>");
    await describeTool(rest[0]);
    return;
  }
  if (cmd === "call") {
    const [name, jsonArgs] = rest;
    if (!name || rest.length > 2) throw new Error("Usage: coregrc call <tool-name> [json-args]");
    print(await invoke(name, jsonArgs));
    return;
  }
  if (RESERVED_COMMANDS.has(cmd)) {
    throw new Error(`Unknown command: ${cmd}\n\n${usage()}`);
  }
  const { name, jsonArgs } = toolNameFromModuleCommand(cmd, rest);
  // Call straight away: the server resolves aliases such as tprm_dashboard and
  // enforces modules and permissions. tools/list is only fetched to explain an
  // unknown name, which saves a round trip on every normal command.
  const result = await invoke(name, jsonArgs);
  if (isUnknownToolResult(result)) {
    assertListedModuleTool(cmd, name, await fetchTools());
  }
  print(result);
}

module.exports = {
  run,
  usage,
  parseModuleFlag,
  toolNameFromModuleCommand,
  RESERVED_COMMANDS,
};
