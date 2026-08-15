import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import type {
  ReminderQuery,
  ReminderQueryResult,
  ReminderList,
  RemindersRepository,
  Reminder,
} from "../src/apple-reminders.js";
import { createServer } from "../src/server.js";

class FakeRemindersRepository implements RemindersRepository {
  lastQuery: ReminderQuery | undefined;

  async listLists(): Promise<ReminderList[]> {
    return [{ id: "list-1", name: "Personal" }];
  }

  async createReminder(): Promise<Reminder> {
    return { id: "created", title: "Created", list: "Personal", completed: false, dueAt: null, priority: 0 };
  }

  async updateReminder(): Promise<Reminder> {
    return { id: "reminder-1", title: "Book dentist", list: "Personal", completed: false, dueAt: null, priority: 0 };
  }

  async moveReminder(): Promise<Reminder> {
    return { id: "reminder-1", title: "Book dentist", list: "Personal", completed: false, dueAt: null, priority: 0 };
  }

  async deleteReminder(): Promise<{ id: string }> {
    return { id: "reminder-1" };
  }

  async listReminders(query: ReminderQuery): Promise<ReminderQueryResult> {
    this.lastQuery = query;
    return {
      reminders: [
        {
          id: "reminder-1",
          title: "Book dentist",
          list: "Personal",
          completed: false,
          dueAt: null,
          priority: 0,
        },
      ],
      truncated: false,
    };
  }
}

async function connect(repository: RemindersRepository) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(repository);
  const client = new Client({ name: "life-dashboard-mcp-test", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("advertises read and approval-gated Apple Reminders tools", async () => {
  const { client, server } = await connect(new FakeRemindersRepository());
  try {
    const response = await client.listTools();
    assert.deepEqual(response.tools.map((tool) => tool.name).sort(), [
      "apple_reminders_complete",
      "apple_reminders_create",
      "apple_reminders_delete",
      "apple_reminders_list",
      "apple_reminders_list_lists",
      "apple_reminders_move",
      "apple_reminders_update",
    ]);
    for (const tool of response.tools) {
      const writeTool = tool.name !== "apple_reminders_list" && tool.name !== "apple_reminders_list_lists";
      assert.equal(tool.annotations?.readOnlyHint, !writeTool);
      assert.equal(tool.annotations?.destructiveHint, tool.name === "apple_reminders_delete");
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("lists reminder lists through structured MCP output", async () => {
  const { client, server } = await connect(new FakeRemindersRepository());
  try {
    const response = await client.callTool({ name: "apple_reminders_list_lists", arguments: {} });
    assert.deepEqual(response.structuredContent, {
      lists: [{ id: "list-1", name: "Personal" }],
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("uses privacy-preserving defaults and validates bounded input", async () => {
  const repository = new FakeRemindersRepository();
  const { client, server } = await connect(repository);
  try {
    const response = await client.callTool({ name: "apple_reminders_list", arguments: {} });
    assert.equal(response.isError, undefined);
    assert.deepEqual(repository.lastQuery, {
      listName: undefined,
      query: undefined,
      completed: false,
      includeNotes: false,
      limit: 25,
    });

    const rejected = await client.callTool({
      name: "apple_reminders_list",
      arguments: { limit: 101 },
    });
    assert.equal(rejected.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});
