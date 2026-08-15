import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const apiBaseUrl = process.env.LIFE_API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1";

async function callMcpTool(
  serverName: string,
  toolName: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
) {
  const serversResponse = await fetch(`${apiBaseUrl}/mcp/servers`, { signal });
  const servers = (await serversResponse.json()) as Array<{ id: string; name: string }>;
  const server = servers.find((item) => item.name.toLowerCase() === serverName.toLowerCase());
  if (!server) throw new Error(`${serverName} MCP server is not configured.`);
  const response = await fetch(
    `${apiBaseUrl}/mcp/servers/${server.id}/tools/${toolName}/call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arguments: parameters }),
      signal,
    },
  );
  const payload = (await response.json()) as {
    detail?: string;
    is_error?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structured_content?: Record<string, unknown> | null;
    approval_required?: boolean;
    approval_id?: string | null;
  };
  if (!response.ok || payload.is_error) {
    throw new Error(payload.detail ?? `The ${serverName} MCP tool failed.`);
  }
  if (payload.approval_required) {
    return {
      content: [{ type: "text" as const, text: `Approval required before running ${serverName} / ${toolName}. Review it in the Agent panel.` }],
      details: { approvalRequired: true, approvalId: payload.approval_id },
    };
  }
  const text = payload.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
  return {
    content: [{ type: "text" as const, text: text || JSON.stringify(payload.structured_content ?? {}) }],
    details: payload.structured_content ?? {},
  };
}

export default function lifeDashboardExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "inbox_create",
    label: "Add to Inbox",
    description: "Add one thought, reminder, or request to the user's private Life Dashboard inbox.",
    promptSnippet: "Add an item to the private Life Dashboard inbox",
    promptGuidelines: [
      "Use inbox_create when the user explicitly asks to remember, capture, or add something to their inbox.",
      "Do not use inbox_create speculatively or create duplicate inbox items.",
    ],
    parameters: Type.Object({
      content: Type.String({
        minLength: 1,
        maxLength: 2000,
        description: "The concise inbox item to save",
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const response = await fetch(`${apiBaseUrl}/inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: params.content.trim() }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Life Dashboard API rejected the inbox item (${response.status}): ${body.slice(0, 500)}`);
      }

      const item = (await response.json()) as { id: number; content: string };
      return {
        content: [{ type: "text", text: `Saved inbox item ${item.id}: ${item.content}` }],
        details: { itemId: item.id },
      };
    },
  });

  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: "Discover and call enabled, explicitly approved MCP tools through the Life Dashboard policy gateway. Only read-only, non-destructive tools are available.",
    promptSnippet: "Use an approved Life Dashboard MCP tool",
    promptGuidelines: [
      "Use action list_tools first when you need to discover available servers or tools.",
      "Use action call only with a server and tool returned by list_tools.",
      "Read-only tools run immediately when approved. Write tools are approval-gated: call them when explicitly requested and tell the user to review the approval card. Never claim an MCP action succeeded until its result confirms it.",
    ],
    parameters: Type.Union([
      Type.Object({ action: Type.Literal("list_tools") }),
      Type.Object({
        action: Type.Literal("call"),
        server: Type.String({ minLength: 1, maxLength: 100 }),
        tool: Type.String({ minLength: 1, maxLength: 200 }),
        arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
    ]),
    async execute(_toolCallId, params, signal) {
      if (params.action === "list_tools") {
        const response = await fetch(`${apiBaseUrl}/mcp/servers`, { signal });
        if (!response.ok) throw new Error(`Could not list MCP servers (${response.status}).`);
        const servers = (await response.json()) as Array<{
          name: string;
          enabled: boolean;
          allowed_tools: string[];
          discovered_tools: Array<{ name: string; description?: string | null; inputSchema?: Record<string, unknown> }>;
        }>;
        const available = servers
          .filter((server) => server.enabled && server.allowed_tools.length > 0)
          .map((server) => ({
            server: server.name,
            tools: server.discovered_tools
              .filter((tool) => server.allowed_tools.includes(tool.name))
              .map((tool) => ({
                name: tool.name,
                description: tool.description ?? null,
                inputSchema: tool.inputSchema ?? {},
              })),
          }));
        return {
          content: [{ type: "text", text: JSON.stringify(available) }],
          details: { servers: available },
        };
      }
      return callMcpTool(params.server, params.tool, params.arguments ?? {}, signal);
    },
  });
}
