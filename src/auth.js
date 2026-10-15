"use strict";

const crypto = require("crypto");
const http = require("http");
const { spawn } = require("child_process");
const { config, resolveSessionUrls } = require("./config");
const { writeCredentials, readCredentials, clearCredentials } = require("./store");

const LOGIN_CALLBACK_PORT_START = 8788;
const LOGIN_CALLBACK_PORT_END = 8798;
const LOGIN_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function pkceS256(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function openBrowserArgs(platform, url) {
  if (platform === "win32") {
    return {
      cmd: "cmd",
      args: ["/c", "start", "", `"${url}"`],
      spawnOptions: { detached: true, stdio: "ignore", windowsVerbatimArguments: true },
    };
  }
  if (platform === "darwin") {
    return { cmd: "open", args: [url], spawnOptions: { detached: true, stdio: "ignore" } };
  }
  return { cmd: "xdg-open", args: [url], spawnOptions: { detached: true, stdio: "ignore" } };
}

function openBrowser(url) {
  const { cmd, args, spawnOptions } = openBrowserArgs(process.platform, url);
  spawn(cmd, args, spawnOptions).unref();
}

function listenLoopback(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

async function bindCallbackServer(startPort = LOGIN_CALLBACK_PORT_START, endPort = LOGIN_CALLBACK_PORT_END) {
  let lastError;
  for (let port = startPort; port <= endPort; port++) {
    try {
      const server = await listenLoopback(port);
      return { server, port };
    } catch (error) {
      lastError = error;
      if (!error || error.code !== "EADDRINUSE") throw error;
    }
  }
  throw lastError || new Error(
    `Could not bind a loopback callback port (${startPort}–${endPort})`
  );
}

function waitForCallback(server, port, timeoutMs = LOGIN_CALLBACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    };
    const timer = setTimeout(() => {
      settle(reject, new Error("Sign-in timed out. Run coregrc login again."));
    }, timeoutMs);

    server.on("request", (req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code") || "";
      const error = url.searchParams.get("error") || "";
      const body = error
        ? "<html><body><p>Authorization failed. You can close this window.</p></body></html>"
        : "<html><body><p>Signed in. You can close this window.</p></body></html>";
      res.writeHead(error ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      if (error) settle(reject, new Error(error));
      else settle(resolve, { code, state: url.searchParams.get("state") || "" });
    });
    server.on("error", (err) => settle(reject, err));
  });
}

async function exchangeCode({ oauthUrl, code, verifier, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: "coregrc-cli",
  });
  const res = await fetch(`${oauthUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error_description || json.error || "Token exchange failed");
  }
  return json;
}

async function login() {
  const cfg = config();
  const verifier = randomString(32);
  const challenge = pkceS256(verifier);
  const state = randomString(16);
  const { server, port } = await bindCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorize = new URL(`${cfg.appOrigin}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", "coregrc-cli");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("resource", cfg.mcpUrl);
  authorize.searchParams.set("scope", "core-grc");

  const pending = waitForCallback(server, port);
  openBrowser(authorize.toString());
  console.log(`Open this URL if the browser does not launch:\n${authorize.toString()}`);
  const result = await pending;
  const returnedState = Buffer.from(String(result.state || ""));
  const expectedState = Buffer.from(state);
  if (
    returnedState.length !== expectedState.length ||
    !crypto.timingSafeEqual(returnedState, expectedState)
  ) {
    throw new Error("OAuth state mismatch");
  }
  if (!result.code) throw new Error("No authorization code returned");
  const tokens = await exchangeCode({
    oauthUrl: cfg.oauthUrl,
    code: result.code,
    verifier,
    redirectUri,
  });
  writeCredentials(cfg.credentialsPath, {
    ...tokens,
    mcpUrl: cfg.mcpUrl,
    oauthUrl: cfg.oauthUrl,
    obtainedAt: new Date().toISOString(),
  });
  console.log("Signed in. Credentials stored for Core GRC CLI.");
}

async function logout() {
  const cfg = config();
  const stored = readCredentials(cfg.credentialsPath);
  const session = resolveSessionUrls(stored);
  if (stored?.refresh_token || stored?.access_token) {
    try {
      await fetch(`${session.oauthUrl}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: stored.refresh_token || stored.access_token,
        }),
      });
    } catch {
      // still clear local credentials
    }
  }
  clearCredentials(cfg.credentialsPath);
  console.log("Signed out.");
}

module.exports = {
  login,
  logout,
  openBrowserArgs,
  bindCallbackServer,
  listenLoopback,
  LOGIN_CALLBACK_PORT_START,
  LOGIN_CALLBACK_PORT_END,
  LOGIN_CALLBACK_TIMEOUT_MS,
};
