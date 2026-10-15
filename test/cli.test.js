"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  openBrowserArgs,
  bindCallbackServer,
  listenLoopback,
} = require("../src/auth");
const { parseModuleFlag, toolNameFromModuleCommand, usage, run } = require("../src/main");
const { DEFAULTS, resolveSessionUrls } = require("../src/config");
const {
  toolCallFailed,
  filterToolsByModule,
  printToolResult,
  printableToolPayload,
  mcpHeaders,
  buildInitializeParams,
  MCP_PROTOCOL_VERSION,
  resetMcpSession,
  ensureInitialized,
  prefixesFromTools,
  assertListedModuleTool,
  parseToolArgs,
  parseMcpHttpBody,
} = require("../src/mcp");

describe("defaults", () => {
  it("uses mcp.core-grc.com, not cloudfunctions.net", () => {
    assert.equal(DEFAULTS.mcpUrl, "https://mcp.core-grc.com/mcpHttp");
    assert.equal(DEFAULTS.oauthUrl, "https://mcp.core-grc.com/mcpOauthHttp");
    assert.equal(DEFAULTS.mcpUrl.includes("cloudfunctions.net"), false);
  });
});

describe("parseModuleFlag", () => {
  it("reads --module value and --module=", () => {
    assert.equal(parseModuleFlag(["--module", "tprm"]), "tprm");
    assert.equal(parseModuleFlag(["--module=consent"]), "consent");
    assert.equal(parseModuleFlag([]), "");
  });
});

describe("openBrowserArgs", () => {
  it("quotes the Windows start URL so query ampersands are not cmd separators", () => {
    const url = "https://app.core-grc.com/oauth/authorize?response_type=code&client_id=coregrc-cli";
    const win = openBrowserArgs("win32", url);
    assert.equal(win.cmd, "cmd");
    assert.deepEqual(win.args, ["/c", "start", "", `"${url}"`]);
    assert.equal(win.spawnOptions.windowsVerbatimArguments, true);
  });

  it("opens macOS and Linux with the raw URL", () => {
    const url = "https://app.core-grc.com/oauth/authorize?a=1&b=2";
    assert.deepEqual(openBrowserArgs("darwin", url).args, [url]);
    assert.deepEqual(openBrowserArgs("linux", url).args, [url]);
  });
});

describe("bindCallbackServer", () => {
  it("falls back when the first port is in use", async () => {
    const blocker = await listenLoopback(8788);
    try {
      const bound = await bindCallbackServer(8788, 8789);
      assert.equal(bound.port, 8789);
      bound.server.close();
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

describe("authorize scope", () => {
  it("sends scope=core-grc on login and does not put an org slug in the URL", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src/auth.js"), "utf8");
    assert.match(src, /authorize\.searchParams\.set\("scope", "core-grc"\)/);
    assert.equal(src.includes('authorize.searchParams.set("org"'), false);
    assert.equal(src.includes("Usage: coregrc login --org"), false);
  });
});

describe("stored URL pinning", () => {
  it("uses stored mcp and oauth URLs unless the matching env var is set", () => {
    const creds = {
      mcpUrl: "https://stored.example/mcpHttp",
      oauthUrl: "https://stored.example/mcpOauthHttp",
    };
    const pinned = resolveSessionUrls(creds, {});
    assert.equal(pinned.mcpUrl, "https://stored.example/mcpHttp");
    assert.equal(pinned.oauthUrl, "https://stored.example/mcpOauthHttp");
    const overridden = resolveSessionUrls(creds, {
      COREGRC_MCP_URL: "https://env.example/mcpHttp",
      COREGRC_OAUTH_URL: "https://env.example/mcpOauthHttp",
    });
    assert.equal(overridden.mcpUrl, "https://env.example/mcpHttp");
    assert.equal(overridden.oauthUrl, "https://env.example/mcpOauthHttp");
  });
});

describe("module subcommands", () => {
  it("maps kebab-case and token actions onto MCP tool names", () => {
    assert.deepEqual(
      toolNameFromModuleCommand("tprm", ["list-entities", '{"entityType":"vendor"}']),
      { name: "tprm_list_entities", jsonArgs: '{"entityType":"vendor"}' }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("tprm", ["list", "entities", '{"entityType":"vendor"}']),
      { name: "tprm_list_entities", jsonArgs: '{"entityType":"vendor"}' }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("consent", ["list-websites"]),
      { name: "consent_list_websites", jsonArgs: undefined }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("policy", ["get", "policy", '{"id":"p1"}']),
      { name: "policy_get_policy", jsonArgs: '{"id":"p1"}' }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("tprm", ["dashboard"]),
      { name: "tprm_dashboard", jsonArgs: undefined }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("tprm", ["get-dashboard"]),
      { name: "tprm_get_dashboard", jsonArgs: undefined }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("tprm", ["risk-analytics"]),
      { name: "tprm_risk_analytics", jsonArgs: undefined }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("webaccess", ["list-websites"]),
      { name: "webaccess_list_websites", jsonArgs: undefined }
    );
    assert.deepEqual(
      toolNameFromModuleCommand("rights", ["get-stats"]),
      { name: "rights_get_stats", jsonArgs: undefined }
    );
  });
});

describe("tool isError", () => {
  it("treats MCP isError as a failed tool call", () => {
    assert.equal(toolCallFailed({ isError: true }), true);
    assert.equal(toolCallFailed({ isError: false, structuredContent: {} }), false);
    assert.equal(toolCallFailed({ structuredContent: { ok: true } }), false);
  });

  it("prints structuredContent and error text instead of the MCP envelope", () => {
    assert.deepEqual(
      printableToolPayload({ structuredContent: { ok: true }, content: [{ type: "text", text: "{\"ok\":true}" }] }),
      { ok: true }
    );
    assert.deepEqual(
      printableToolPayload({
        isError: true,
        structuredContent: { success: false, error: "Unknown tool: x" },
        content: [{ type: "text", text: "{\"success\":false}" }],
      }),
      { success: false, error: "Unknown tool: x" }
    );
    assert.equal(
      printableToolPayload({ isError: true, content: [{ type: "text", text: "Unknown tool: x" }] }),
      "Unknown tool: x"
    );
  });
});

describe("MCP HTTP body", () => {
  it("parses JSON and Streamable HTTP SSE message events", () => {
    assert.deepEqual(parseMcpHttpBody('{"result":{"ok":true}}'), { result: { ok: true } });
    assert.deepEqual(
      parseMcpHttpBody('event: message\ndata: {"result":{"protocolVersion":"2025-03-26"}}\n\n'),
      { result: { protocolVersion: "2025-03-26" } }
    );
  });
});

describe("tools --module filter", () => {
  it("keeps tools whose names start with the module prefix", () => {
    const tools = [
      { name: "coregrc_whoami" },
      { name: "tprm_list_entities" },
      { name: "consent_list_websites" },
    ];
    assert.deepEqual(
      filterToolsByModule(tools, "tprm").map((tool) => tool.name),
      ["tprm_list_entities"]
    );
  });
});

describe("help copy", () => {
  it("brands the CLI as Core GRC and uses singular entityType examples", () => {
    const text = usage();
    assert.match(text, /coregrc — Core GRC CLI/);
    assert.match(text, /coregrc login/);
    assert.equal(text.includes("coregrc login --org"), false);
    assert.equal(text.includes("TPRM CLI"), false);
    assert.match(text, /entityType":"vendor"/);
    assert.equal(text.includes('"vendors"'), false);
    assert.match(text, /prefixes from tools\/list/);
    assert.match(text, /coregrc tprm dashboard/);
    assert.match(text, /coregrc webaccess list-websites/);
    assert.match(text, /coregrc rights get-stats/);
    assert.match(text, /policy delete policy/);
    assert.match(text, /confirm:true/);
  });
});

describe("live tools/list module discovery", () => {
  it("derives prefixes from listed tool names", () => {
    const tools = [
      { name: "coregrc_whoami" },
      { name: "tprm_list_entities" },
      { name: "consent_list_websites" },
      { name: "policy_get_policy" },
    ];
    assert.deepEqual([...prefixesFromTools(tools)].sort(), ["consent", "coregrc", "policy", "tprm"]);
  });

  it("calls a later pack without a CLI allowlist edit", async () => {
    let called = null;
    await run(["rights", "list-requests"], {
      fetchToolList: async () => [{ name: "rights_list_requests" }],
      callTool: async (name, jsonArgs) => {
        called = { name, jsonArgs };
      },
    });
    assert.deepEqual(called, { name: "rights_list_requests", jsonArgs: undefined });
  });

  it("rejects an unknown module prefix from the live list", async () => {
    await assert.rejects(
      () => run(["consent", "list-websites"], {
        fetchToolList: async () => [{ name: "tprm_list_entities" }],
        callTool: async () => {
          throw new Error("should not call");
        },
      }),
      /Unknown command: consent/
    );
  });

  it("rejects a tool missing from the live list", () => {
    assert.throws(
      () => assertListedModuleTool("tprm", "tprm_delete_entity", [{ name: "tprm_list_entities" }]),
      /Unknown tool: tprm_delete_entity/
    );
  });
});

describe("parseToolArgs", () => {
  it("requires a JSON object and explains invalid JSON", () => {
    assert.deepEqual(parseToolArgs(), {});
    assert.deepEqual(parseToolArgs('{"entityType":"vendor"}'), { entityType: "vendor" });
    assert.throws(() => parseToolArgs("{"), /Invalid JSON arguments/);
    assert.throws(() => parseToolArgs("[1]"), /JSON object/);
  });
});

describe("tool isError exit", () => {
  it("sets process.exitCode when printToolResult sees isError", () => {
    const previous = process.exitCode;
    const originalLog = console.log;
    console.log = () => {};
    try {
      process.exitCode = 0;
      printToolResult({ isError: true, content: [] });
      assert.equal(process.exitCode, 1);
    } finally {
      console.log = originalLog;
      process.exitCode = previous;
    }
  });
});

describe("MCP initialize", () => {
  it("sends initialize, notifications/initialized, and MCP-Protocol-Version", async () => {
    resetMcpSession();
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body, headers: options.headers });
      if (body.method === "notifications/initialized") {
        return { status: 202, ok: true, text: async () => "" };
      }
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } }),
      };
    };
    try {
      assert.equal(mcpHeaders("tok")["MCP-Protocol-Version"], MCP_PROTOCOL_VERSION);
      assert.equal(buildInitializeParams().protocolVersion, MCP_PROTOCOL_VERSION);
      await ensureInitialized({ mcpUrl: "https://example.test/mcpHttp" }, { access_token: "tok" });
      await ensureInitialized({ mcpUrl: "https://example.test/mcpHttp" }, { access_token: "tok" });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].body.method, "initialize");
      assert.equal(calls[0].headers["MCP-Protocol-Version"], MCP_PROTOCOL_VERSION);
      assert.equal(calls[1].body.method, "notifications/initialized");
      assert.equal(Object.prototype.hasOwnProperty.call(calls[1].body, "id"), false);
    } finally {
      global.fetch = originalFetch;
      resetMcpSession();
    }
  });
});

describe("token and 401 handling", () => {
  const os = require("os");
  const mcp = require("../src/mcp");

  it("reports a non-JSON token response by HTTP status", async () => {
    const res = { status: 502, text: async () => "<html>Bad Gateway</html>" };
    const json = await mcp.readJsonResponse(res);
    assert.match(json.error_description, /HTTP 502/);
  });

  it("refreshes once and retries when the server answers 401", async () => {
    mcp.resetMcpSession();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coregrc-test-"));
    const credsPath = path.join(dir, "credentials.json");
    fs.writeFileSync(credsPath, JSON.stringify({
      access_token: "stale",
      refresh_token: "refresh-1",
      expires_in: 86400,
      obtainedAt: new Date().toISOString(),
      mcpUrl: "https://example.test/mcpHttp",
      oauthUrl: "https://example.test/mcpOauthHttp",
    }));
    const previousEnv = process.env.COREGRC_CREDENTIALS;
    process.env.COREGRC_CREDENTIALS = credsPath;
    const originalFetch = global.fetch;
    const seen = [];
    global.fetch = async (url, options) => {
      if (String(url).endsWith("/token")) {
        seen.push("token");
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ access_token: "fresh", refresh_token: "refresh-2", expires_in: 86400 }),
        };
      }
      const body = JSON.parse(options.body);
      const token = options.headers.Authorization.replace("Bearer ", "");
      seen.push(`${body.method}:${token}`);
      if (token === "stale") {
        return { status: 401, ok: false, text: async () => JSON.stringify({ error: "invalid_token", error_description: "access token expired; use refresh_token" }) };
      }
      if (body.method === "notifications/initialized") return { status: 202, ok: true, text: async () => "" };
      return { status: 200, ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }) };
    };
    try {
      const result = await mcp.mcpRpc("tools/list", {});
      assert.deepEqual(result, { tools: [] });
      assert.deepEqual(seen, ["initialize:stale", "token", "initialize:fresh", "notifications/initialized:fresh", "tools/list:fresh"]);
      assert.equal(JSON.parse(fs.readFileSync(credsPath, "utf8")).refresh_token, "refresh-2");
    } finally {
      global.fetch = originalFetch;
      if (previousEnv === undefined) delete process.env.COREGRC_CREDENTIALS;
      else process.env.COREGRC_CREDENTIALS = previousEnv;
      fs.rmSync(dir, { recursive: true, force: true });
      mcp.resetMcpSession();
    }
  });
});

describe("aliases and version", () => {
  it("resolves an alias such as tprm dashboard through the server", async () => {
    let called = null;
    await run(["tprm", "dashboard"], {
      fetchToolList: async () => [{ name: "tprm_get_dashboard" }],
      resolveToolAlias: async (name) => (name === "tprm_dashboard" ? "tprm_get_dashboard" : null),
      callTool: async (name, jsonArgs) => {
        called = { name, jsonArgs };
      },
    });
    assert.deepEqual(called, { name: "tprm_get_dashboard", jsonArgs: undefined });
  });

  it("still rejects a name the server does not know", async () => {
    await assert.rejects(
      () => run(["tprm", "frobnicate"], {
        fetchToolList: async () => [{ name: "tprm_get_dashboard" }],
        resolveToolAlias: async () => null,
        callTool: async () => {
          throw new Error("should not call");
        },
      }),
      /Unknown tool: tprm_frobnicate/
    );
  });

  it("does not ask the server when the name is already listed", async () => {
    let resolved = false;
    await run(["rights", "get-stats"], {
      fetchToolList: async () => [{ name: "rights_get_stats" }],
      resolveToolAlias: async () => {
        resolved = true;
        return null;
      },
      callTool: async () => {},
    });
    assert.equal(resolved, false);
  });

  it("prints the package version", async () => {
    const { version } = require("../package.json");
    const lines = [];
    const originalLog = console.log;
    console.log = (line) => lines.push(line);
    try {
      await run(["--version"]);
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(lines, [version]);
    assert.equal(buildInitializeParams().clientInfo.version, version);
  });
});
