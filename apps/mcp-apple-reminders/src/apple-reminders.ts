import { execFile } from "node:child_process";

export type ReminderList = {
  id: string;
  name: string;
};

export type Reminder = {
  id: string;
  title: string;
  notes?: string;
  list: string;
  completed: boolean;
  dueAt: string | null;
  priority: number;
};

export type ReminderQuery = {
  listName?: string;
  query?: string;
  completed: boolean | null;
  includeNotes: boolean;
  limit: number;
};

export type ReminderQueryResult = {
  reminders: Reminder[];
  truncated: boolean;
};

export interface RemindersRepository {
  listLists(): Promise<ReminderList[]>;
  listReminders(query: ReminderQuery): Promise<ReminderQueryResult>;
}

type ScriptRunner = (script: string, argument: unknown) => Promise<string>;

const LISTS_SCRIPT = String.raw`
function run(argv) {
  const reminders = Application("Reminders");
  const lists = reminders.lists();
  const output = [];

  for (let index = 0; index < lists.length; index += 1) {
    const list = lists[index];
    output.push({ id: String(list.id()), name: String(list.name()) });
  }

  output.sort(function (left, right) { return left.name.localeCompare(right.name); });
  return JSON.stringify(output);
}
`;

const REMINDERS_SCRIPT = String.raw`
ObjC.import("stdlib");

function isoDate(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (_) {
    return null;
  }
}

function run() {
  const input = JSON.parse(ObjC.unwrap($.getenv("LIFE_REMINDERS_MCP_INPUT")) || "{}");
  const reminders = Application("Reminders");
  const targetName = input.listName ? String(input.listName).toLocaleLowerCase() : null;
  const search = input.query ? String(input.query).toLocaleLowerCase() : null;
  if (targetName !== null) {
    const availableNames = reminders.lists.name().map(function (name) { return String(name).toLocaleLowerCase(); });
    if (availableNames.indexOf(targetName) === -1) throw new Error("The requested reminder list was not found.");
  }

  // Batch each property across the collection. This avoids one Apple Event per
  // reminder, which is dramatically slower for synced Reminders libraries.
  const items = reminders.reminders;
  const titles = items.name();
  const completedValues = items.completed();
  const listNames = items.container.name();
  const ids = items.id();
  const dueDates = items.dueDate();
  const priorities = items.priority();
  const notes = input.includeNotes ? items.body() : null;
  const output = [];
  let truncated = false;

  for (let itemIndex = 0; itemIndex < titles.length; itemIndex += 1) {
    const listName = String(listNames[itemIndex] || "");
    if (targetName !== null && listName.toLocaleLowerCase() !== targetName) continue;

    const completed = Boolean(completedValues[itemIndex]);
    if (input.completed !== null && completed !== input.completed) continue;

    const title = String(titles[itemIndex] || "");
    if (search !== null && title.toLocaleLowerCase().indexOf(search) === -1) continue;
    if (output.length >= input.limit) {
      truncated = true;
      break;
    }

    const result = {
      id: String(ids[itemIndex] || ""),
      title: title,
      list: listName,
      completed: completed,
      dueAt: isoDate(dueDates[itemIndex]),
      priority: Number(priorities[itemIndex]) || 0
    };
    if (notes !== null) {
      const note = String(notes[itemIndex] || "");
      if (note) result.notes = note;
    }
    output.push(result);
  }

  return JSON.stringify({ reminders: output, truncated: truncated });
}
`;

function runAppleScript(script: string, argument: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, LIFE_REMINDERS_MCP_INPUT: JSON.stringify(argument) },
        maxBuffer: 1_048_576,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(detail));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Reminders returned an invalid response.");
  }
}

export class AppleRemindersRepository implements RemindersRepository {
  constructor(private readonly runner: ScriptRunner = runAppleScript) {}

  async listLists(): Promise<ReminderList[]> {
    return parseJson<ReminderList[]>(await this.runner(LISTS_SCRIPT, {}));
  }

  async listReminders(query: ReminderQuery): Promise<ReminderQueryResult> {
    return parseJson<ReminderQueryResult>(await this.runner(REMINDERS_SCRIPT, query));
  }
}

export function friendlyRemindersError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/not authorized|not permitted|-1743|automation/i.test(detail)) {
    return "Apple Reminders access is not authorized. Allow the host application under System Settings > Privacy & Security > Automation or Reminders, then try again.";
  }
  if (/timed out|ETIMEDOUT|killed/i.test(detail)) {
    return "Apple Reminders did not respond within 30 seconds.";
  }
  return `Apple Reminders could not be read: ${detail}`;
}
