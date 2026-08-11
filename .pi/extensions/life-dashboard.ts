import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const apiBaseUrl = process.env.LIFE_API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1";

async function callAppleRemindersTool(
  toolName: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${apiBaseUrl}/mcp/servers/apple-reminders/tools/${toolName}/call`,
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
  };
  if (!response.ok || payload.is_error) {
    throw new Error(payload.detail ?? "The Apple Reminders MCP tool failed.");
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
    name: "apple_reminders_list_lists",
    label: "List Apple Reminder Lists",
    description: "Read the user's Apple Reminders list names through the local, read-only MCP policy gateway.",
    promptSnippet: "List the available Apple Reminders lists",
    promptGuidelines: [
      "Use only when the user asks about Apple Reminders or needs to choose a reminder list.",
      "This tool is read-only. Do not imply that it can create, complete, edit, move, or delete reminders.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, params, signal) {
      return callAppleRemindersTool("apple_reminders_list_lists", params, signal);
    },
  });

  pi.registerTool({
    name: "apple_reminders_list",
    label: "Read Apple Reminders",
    description: "Read and filter Apple Reminders through the local MCP policy gateway. Notes stay excluded unless explicitly requested.",
    promptSnippet: "Read Apple Reminders without changing them",
    promptGuidelines: [
      "Use when the user asks to inspect, search, or summarize Apple Reminders.",
      "Request notes only when they are necessary for the user's question.",
      "This tool is read-only. Never claim it changed a reminder.",
    ],
    parameters: Type.Object({
      listName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      status: Type.Optional(Type.Union([
        Type.Literal("incomplete"),
        Type.Literal("completed"),
        Type.Literal("all"),
      ])),
      includeNotes: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_toolCallId, params, signal) {
      return callAppleRemindersTool("apple_reminders_list", params, signal);
    },
  });
}
