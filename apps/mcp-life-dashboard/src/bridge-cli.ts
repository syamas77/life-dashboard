#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const input = JSON.parse(await new Promise<string>((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { value += chunk; });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
}));
const serverPath = new URL("./index.js", import.meta.url).pathname;
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: "pipe" });
const client = new Client({ name: "life-dashboard-pi-bridge", version: "0.1.0" });
try {
  await client.connect(transport);
  const result = input.action === "list_tools"
    ? await client.listTools()
    : await client.callTool({ name: input.tool, arguments: input.arguments ?? {} });
  process.stdout.write(JSON.stringify(result));
} finally {
  await client.close().catch(() => undefined);
}
