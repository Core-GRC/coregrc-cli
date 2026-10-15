"use strict";

const os = require("os");
const path = require("path");

const DEFAULTS = {
  appOrigin: "https://app.core-grc.com",
  mcpUrl: "https://mcp.core-grc.com/mcpHttp",
  oauthUrl: "https://mcp.core-grc.com/mcpOauthHttp",
};

function envOr(name, fallback, env = process.env) {
  const value = String(env[name] || "").trim();
  return value || fallback;
}

function envIsSet(name, env = process.env) {
  return String(env[name] || "").trim() !== "";
}

function config(env = process.env) {
  return {
    appOrigin: envOr("COREGRC_APP_ORIGIN", DEFAULTS.appOrigin, env).replace(/\/$/, ""),
    mcpUrl: envOr("COREGRC_MCP_URL", DEFAULTS.mcpUrl, env).replace(/\/$/, ""),
    oauthUrl: envOr("COREGRC_OAUTH_URL", DEFAULTS.oauthUrl, env).replace(/\/$/, ""),
    credentialsPath: envOr(
      "COREGRC_CREDENTIALS",
      path.join(os.homedir(), ".config", "coregrc", "credentials.json"),
      env
    ),
  };
}

function resolveSessionUrls(creds, env = process.env) {
  const cfg = config(env);
  return {
    ...cfg,
    mcpUrl: envIsSet("COREGRC_MCP_URL", env)
      ? cfg.mcpUrl
      : String(creds?.mcpUrl || cfg.mcpUrl).replace(/\/$/, ""),
    oauthUrl: envIsSet("COREGRC_OAUTH_URL", env)
      ? cfg.oauthUrl
      : String(creds?.oauthUrl || cfg.oauthUrl).replace(/\/$/, ""),
  };
}

module.exports = { config, DEFAULTS, envIsSet, resolveSessionUrls };
