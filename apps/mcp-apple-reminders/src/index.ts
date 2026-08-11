#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

const handle = serveStdio(() => createServer());

process.on("SIGINT", () => {
  void handle.close();
});

process.on("SIGTERM", () => {
  void handle.close();
});

console.error("Life Dashboard Apple Reminders MCP server is running in read-only mode over stdio.");
