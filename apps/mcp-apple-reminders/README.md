# Life Dashboard Apple Reminders MCP server

A project-owned, local, read-only MCP server for macOS Apple Reminders.

## Current security boundary

The server exposes exactly two tools:

- `apple_reminders_list_lists` — list reminder-list names and local IDs
- `apple_reminders_list` — read reminders with optional list, title, completion-status, note, and result-limit controls

It does **not** expose create, update, complete, move, or delete operations. Those are external side effects and must wait for Life Dashboard Approval Center integration.

The server:

- Uses the official MCP TypeScript SDK over stdio
- Executes `/usr/bin/osascript` directly with `execFile`, never through a shell
- Passes validated input through a private child-process environment payload instead of interpolating it into JXA source or exposing it in command-line arguments
- Marks both tools read-only and non-destructive
- Excludes reminder notes by default
- Limits each call to 100 reminders, 1 MiB of process output, and 30 seconds
- Writes logs only to stderr because stdout is reserved for MCP JSON-RPC
- Has no network listener and makes no network requests
- Never reads `life.db`

## Requirements

- macOS with Apple Reminders
- Node.js 20 or later
- Automation/Reminders permission for the application that launches the MCP process

On first access, macOS may show a permission prompt. Permissions can be reviewed under **System Settings → Privacy & Security → Automation** or **Reminders**.

## Install and verify

```bash
cd apps/mcp-apple-reminders
npm install
npm run check
```

Build and start the stdio server:

```bash
npm run build
npm start
```

An stdio server waits silently for an MCP host. Its readiness message appears on stderr.

Test interactively with the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js
```

## Host configuration

Any MCP host that supports local stdio servers can launch the compiled entry point:

```json
{
  "mcpServers": {
    "life-apple-reminders": {
      "command": "node",
      "args": [
        "/absolute/path/to/life-dashboard/apps/mcp-apple-reminders/dist/src/index.js"
      ]
    }
  }
}
```

Use an absolute path. The MCP host—not Terminal—may need its own macOS Reminders permission.

## Query behavior

`apple_reminders_list` accepts:

- `listName`: exact list name, matched case-insensitively
- `query`: case-insensitive title search; notes are not searched
- `status`: `incomplete` (default), `completed`, or `all`
- `includeNotes`: `false` by default
- `limit`: 1–100, default 25

Apple's JXA bridge can be slow for synced libraries. The implementation batches each property across the Reminders collection to avoid one Apple Event per reminder. A future signed EventKit helper can improve performance without changing the MCP tool contract.

## Not yet connected to the dashboard agent

The MCP server and real macOS read path work independently. The restricted Pi harness does not receive these tools yet. The next integration step is a project-owned MCP client/policy gateway that exposes the two read-only tools to Pi, records bounded calls in the ledger, and keeps future write tools behind explicit approvals.
