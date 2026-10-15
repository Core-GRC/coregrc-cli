#!/usr/bin/env node
"use strict";

const { run } = require("../src/main");

run(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
