import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const apiBaseUrl = process.env.LIFE_API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1";

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
}
