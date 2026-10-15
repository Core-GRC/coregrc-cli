"use strict";

const { config, resolveSessionUrls } = require("./config");
const { readCredentials, writeCredentials } = require("./store");

const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLI_VERSION = require("../package.json").version;

let rpcId = 1;
let initializedFor = "";

function resetMcpSession() {
  rpcId = 1;
  initializedFor = "";
}

function nextRpcId() {
  const id = rpcId;
  rpcId += 1;
  return id;
}

function toolCallFailed(result) {
  return Boolean(result && result.isError === true);
}

function parseMcpHttpBody(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const dataLines = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) {
      return JSON.parse(dataLines[dataLines.length - 1]);
    }
    throw new Error("MCP HTTP response was not JSON");
  }
}

function mcpHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
}

function buildInitializeParams() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "coregrc", version: CLI_VERSION },
  };
}

async function readJsonResponse(res) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { error_description: `Server returned HTTP ${res.status} without a JSON body` };
  }
}

async function refreshIfNeeded(creds, session, { force = false } = {}) {
  if (!creds?.access_token) throw new Error("Not signed in. Run: coregrc login");
  const obtained = creds.obtainedAt ? Date.parse(creds.obtainedAt) : 0;
  const expiresIn = Number(creds.expires_in || 3600) * 1000;
  if (!force && obtained && Date.now() < obtained + expiresIn - 60_000) return creds;
  if (!creds.refresh_token) return creds;
  const res = await fetch(`${session.oauthUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
      client_id: "coregrc-cli",
    }),
  });
  const json = await readJsonResponse(res);
  if (!res.ok) throw new Error(json.error_description || `Could not refresh access token (HTTP ${res.status})`);
  const next = { ...creds, ...json, obtainedAt: new Date().toISOString() };
  writeCredentials(session.credentialsPath, next);
  return next;
}

async function postJsonRpc(url, accessToken, message) {
  const res = await fetch(url, {
    method: "POST",
    headers: mcpHeaders(accessToken),
    body: JSON.stringify(message),
  });
  const raw = await res.text();
  if (res.status === 202 && !raw) return null;
  let json;
  try {
    json = parseMcpHttpBody(raw);
  } catch {
    throw new Error(`MCP HTTP ${res.status}`);
  }
  if (!res.ok) {
    const error = new Error(json.error_description || json.error?.message || `MCP HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}

async function ensureInitialized(session, creds) {
  const key = `${session.mcpUrl}\0${creds.access_token}`;
  if (initializedFor === key) return;
  await postJsonRpc(session.mcpUrl, creds.access_token, {
    jsonrpc: "2.0",
    id: nextRpcId(),
    method: "initialize",
    params: buildInitializeParams(),
  });
  await postJsonRpc(session.mcpUrl, creds.access_token, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  initializedFor = key;
}

async function mcpRpcWith(session, creds, method, params) {
  await ensureInitialized(session, creds);
  return postJsonRpc(session.mcpUrl, creds.access_token, {
    jsonrpc: "2.0",
    id: nextRpcId(),
    method,
    params,
  });
}

async function mcpRpc(method, params) {
  const stored = readCredentials(config().credentialsPath);
  const session = resolveSessionUrls(stored);
  const creds = await refreshIfNeeded(stored, session);
  try {
    return await mcpRpcWith(session, creds, method, params);
  } catch (error) {
    // The local clock can disagree with the server about expiry. On a 401,
    // refresh once and retry before giving up.
    if (error.status !== 401 || !creds.refresh_token) throw error;
    const refreshed = await refreshIfNeeded(creds, session, { force: true });
    return mcpRpcWith(session, refreshed, method, params);
  }
}

function filterToolsByModule(tools, moduleName) {
  const prefix = String(moduleName || "").trim();
  if (!prefix) return tools;
  return tools.filter((tool) => String(tool.name || "").startsWith(`${prefix}_`));
}

function prefixesFromTools(tools) {
  const prefixes = new Set();
  for (const tool of tools || []) {
    const name = String(tool.name || "");
    const idx = name.indexOf("_");
    if (idx > 0) prefixes.add(name.slice(0, idx));
  }
  return prefixes;
}

function modulePrefixExists(prefix, tools) {
  return prefixesFromTools(tools).has(String(prefix || "").trim());
}

function assertListedModuleTool(moduleName, toolName, tools) {
  if (!modulePrefixExists(moduleName, tools)) {
    throw new Error(`Unknown command: ${moduleName}`);
  }
  if (!(tools || []).some((tool) => tool.name === toolName)) {
    throw new Error(`Unknown tool: ${toolName}. Run: coregrc tools --module ${moduleName}`);
  }
}

async function fetchToolList() {
  const result = await mcpRpc("tools/list", {});
  return result.tools || [];
}

/**
 * The server starts each description with the tool name and title so clients
 * that hide the title still show it. The list already prints the name, so drop both.
 */
function plainToolDescription(tool) {
  let text = String((tool && tool.description) || "");
  for (const prefix of [tool && tool.name, tool && tool.title]) {
    if (prefix && text.startsWith(`${prefix}. `)) text = text.slice(prefix.length + 2);
  }
  return text;
}

async function listTools(moduleName) {
  const tools = filterToolsByModule(await fetchToolList(), moduleName);
  for (const tool of tools) {
    console.log(`${tool.name}\t${plainToolDescription(tool)}`);
  }
}

function printableToolPayload(result) {
  if (!result || typeof result !== "object") return result;
  if (Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return result.structuredContent;
  }
  if (result.isError === true) {
    const text = result.content && result.content[0] && result.content[0].text;
    return typeof text === "string" ? text : result;
  }
  const text = result.content && result.content[0] && result.content[0].text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
}

function printToolResult(result) {
  const payload = printableToolPayload(result);
  console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  if (toolCallFailed(result)) process.exitCode = 1;
}

function parseToolArgs(argsJson) {
  if (!argsJson) return {};
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new Error("Invalid JSON arguments. Pass an object, for example '{\"entityType\":\"vendor\"}'.");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return args;
}

/** The server's reply when no tool or alias has this name. */
function isUnknownToolResult(result) {
  if (!toolCallFailed(result)) return false;
  const error = result.structuredContent && result.structuredContent.error;
  return typeof error === "string" && error.startsWith("Unknown tool: ");
}

async function callTool(name, argsJson) {
  const args = parseToolArgs(argsJson);
  return mcpRpc("tools/call", { name, arguments: args });
}

async function whoami() {
  const result = await mcpRpc("tools/call", { name: "coregrc_whoami", arguments: {} });
  printToolResult(result);
  return result;
}

async function describeTool(name) {
  const toolName = String(name || "").trim();
  if (!toolName) throw new Error("Usage: coregrc describe <tool-name>");
  const tools = await fetchToolList();
  const tool = tools.find((item) => item.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  console.log(JSON.stringify({
    name: tool.name,
    title: tool.title || "",
    description: tool.description || "",
    inputSchema: tool.inputSchema || {},
  }, null, 2));
}

module.exports = {
  mcpRpc,
  listTools,
  callTool,
  whoami,
  describeTool,
  toolCallFailed,
  filterToolsByModule,
  printToolResult,
  fetchToolList,
  isUnknownToolResult,
  plainToolDescription,
  mcpHeaders,
  buildInitializeParams,
  MCP_PROTOCOL_VERSION,
  CLI_VERSION,
  resetMcpSession,
  prefixesFromTools,
  modulePrefixExists,
  assertListedModuleTool,
  parseToolArgs,
  ensureInitialized,
  printableToolPayload,
  parseMcpHttpBody,
  refreshIfNeeded,
  readJsonResponse,
};
