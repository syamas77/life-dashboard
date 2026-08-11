import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  AppleRemindersRepository,
  friendlyRemindersError,
  type ReminderQuery,
  type RemindersRepository,
} from "./apple-reminders.js";

const reminderListSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const reminderSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  list: z.string(),
  completed: z.boolean(),
  dueAt: z.string().nullable(),
  priority: z.number(),
});

const listOutputSchema = z.object({
  lists: z.array(reminderListSchema),
});

const remindersOutputSchema = z.object({
  reminders: z.array(reminderSchema),
  truncated: z.boolean(),
});

const remindersInputSchema = z.object({
  listName: z.string().trim().min(1).max(200).optional().describe("Exact Apple Reminders list name"),
  query: z.string().trim().min(1).max(200).optional().describe("Case-insensitive title search; reminder notes are not searched"),
  status: z.enum(["incomplete", "completed", "all"]).default("incomplete").describe("Completion status to include"),
  includeNotes: z.boolean().default(false).describe("Include reminder notes in the result; disabled by default to minimize context"),
  limit: z.number().int().min(1).max(100).default(25).describe("Maximum reminders returned"),
});

function textResult(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: friendlyRemindersError(error) }],
    isError: true as const,
  };
}

export function createServer(repository: RemindersRepository = new AppleRemindersRepository()): McpServer {
  const server = new McpServer({
    name: "life-dashboard-apple-reminders",
    version: "0.1.0",
  });

  server.registerTool(
    "apple_reminders_list_lists",
    {
      title: "List Apple Reminder Lists",
      description: "Read the names and local identifiers of Apple Reminders lists. This tool never changes reminders.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      outputSchema: listOutputSchema,
    },
    async () => {
      try {
        const output = { lists: await repository.listLists() };
        return { content: textResult(output), structuredContent: output };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "apple_reminders_list",
    {
      title: "Read Apple Reminders",
      description: "Read and optionally filter Apple Reminders by exact list, completion status, or title. Notes are excluded unless explicitly requested. This tool never creates, completes, edits, or deletes reminders.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: remindersInputSchema,
      outputSchema: remindersOutputSchema,
    },
    async ({ listName, query, status, includeNotes, limit }) => {
      const completedByStatus: Record<typeof status, boolean | null> = {
        incomplete: false,
        completed: true,
        all: null,
      };
      const reminderQuery: ReminderQuery = {
        listName,
        query,
        completed: completedByStatus[status],
        includeNotes,
        limit,
      };

      try {
        const output = await repository.listReminders(reminderQuery);
        return { content: textResult(output), structuredContent: output };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
