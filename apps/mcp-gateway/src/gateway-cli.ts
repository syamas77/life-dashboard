#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import * as z from "zod/v4";

const serverSchema = z.object({
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(1000)).max(30).default([]),
  cwd: z.string().min(1).max(500).nullable().default(null),
  allowedTools: z.array(z.string().min(1).max(200)).max(100).default([]),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), server: serverSchema }),
  z.object({
    action: z.literal("call"),
    server: serverSchema,
    tool: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
]);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 65_536) throw new Error("Gateway request exceeds 64 KiB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MCP operation timed out.")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function main() {
  const request = requestSchema.parse(JSON.parse(await readStdin()));
  const transport = new StdioClientTransport({
    command: request.server.command,
    args: request.server.args,
    cwd: request.server.cwd ?? undefined,
    stderr: "pipe",
    maxBufferSize: 1_048_576,
  });
  const client = new Client({ name: "life-dashboard-mcp-policy-gateway", version: "0.1.0" });

  try {
    await withTimeout(client.connect(transport), 10_000);
    const listed = await withTimeout(client.listTools(), 15_000);
    const tools = listed.tools.slice(0, 100).map((tool) => ({
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations ?? null,
    }));

    if (request.action === "inspect") {
      process.stdout.write(JSON.stringify({ tools, truncated: listed.tools.length > 100 }));
      return;
    }

    const tool = listed.tools.find((candidate) => candidate.name === request.tool);
    if (!tool) throw new Error("The configured MCP server does not advertise this tool.");
    if (!request.server.allowedTools.includes(request.tool)) {
      throw new Error("This MCP tool is not in the server allowlist.");
    }
    const result = await withTimeout(
      client.callTool({ name: request.tool, arguments: request.arguments }),
      35_000,
    );
    process.stdout.write(JSON.stringify({
      isError: result.isError === true,
      content: result.content,
      structuredContent: result.structuredContent ?? null,
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
