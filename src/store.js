"use strict";

const fs = require("fs");
const path = require("path");

function readCredentials(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCredentials(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function clearCredentials(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone
  }
}

module.exports = { readCredentials, writeCredentials, clearCredentials };
