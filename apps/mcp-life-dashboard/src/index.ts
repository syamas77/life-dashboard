import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const API = process.env.LIFE_API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `Life Dashboard API failed (${response.status})`);
  return body;
}

const server = new McpServer({ name: "life-dashboard", version: "0.1.0" });
const text = (value: unknown) => [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];

server.registerTool("inbox_create", { title: "Add to Life Dashboard Inbox", description: "Save a thought or reminder to the private Life Dashboard inbox.", inputSchema: z.object({ content: z.string().trim().min(1).max(2000) }), annotations: { readOnlyHint: false, destructiveHint: false } }, async ({ content }) => ({ content: text(await request("/inbox", { method: "POST", body: JSON.stringify({ content }) })) }));
server.registerTool("task_create", { title: "Create Life Dashboard Task", description: "Create an actionable task on the Life Dashboard Board.", inputSchema: z.object({ title: z.string().trim().min(1).max(300), notes: z.string().max(5000).optional(), context: z.string().max(100).optional(), due_at: z.string().optional() }), annotations: { readOnlyHint: false, destructiveHint: false } }, async (input) => ({ content: text(await request("/tasks", { method: "POST", body: JSON.stringify({ ...input, context: input.context ?? "Agent" }) })) }));
server.registerTool("mcp_list_tools", { title: "List Connected MCP Tools", description: "List tools allowed by the Life Dashboard MCP policy.", inputSchema: z.object({}) }, async () => { const servers = await request("/mcp/servers"); return { content: text(servers.filter((item: any) => item.enabled).map((item: any) => ({ server: item.name, tools: item.discovered_tools.filter((tool: any) => item.allowed_tools.includes(tool.name)) }))) }; });
server.registerTool("mcp_call", { title: "Call Connected MCP Tool", description: "Call an allowed connected MCP tool. Writes remain approval-gated by the Life Dashboard policy gateway.", inputSchema: z.object({ server: z.string().min(1), tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }) }, async ({ server: serverName, tool, arguments: args }) => { const servers = await request("/mcp/servers"); const target = servers.find((item: any) => item.enabled && item.name.toLowerCase() === serverName.toLowerCase()); if (!target) throw new Error(`MCP server not found: ${serverName}`); return { content: text(await request(`/mcp/servers/${target.id}/tools/${encodeURIComponent(tool)}/call`, { method: "POST", body: JSON.stringify({ arguments: args }) })) }; });

serveStdio(() => server);
