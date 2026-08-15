# Life Dashboard

A local-first personal operating system for managing daily life with agent assistance.

## Vision

Bring schedules, priorities, notes, relationships, goals, and personal context into one calm dashboard. Agents connect through ACP and remain interchangeable rather than owning the underlying data.

## Planned stack

- **Web:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- **API:** FastAPI, Pydantic, SQLAlchemy, Alembic
- **Storage:** SQLite locally, with a path to PostgreSQL
- **Agents:** Pi connected through ACP, with an adapter boundary for future ACP-compatible harnesses

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for Mermaid diagrams covering the local application, request flow, Docker direction, and database migrations. See [`docs/future-additions.md`](docs/future-additions.md) for the benchmark, Autonomous Agents, and MCP server roadmap.

## Development

Install the pinned Pi ACP adapter:

```bash
cd apps/agent
npm install
```

Install the policy gateway and verify the read-only Apple Reminders MCP server on macOS:

```bash
cd apps/mcp-gateway
npm install
npm run build
cd ../mcp-apple-reminders
npm install
npm run check
```

Start the local API:

```bash
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Start the web interface in another terminal:

```bash
cd apps/web
npm install
npm run dev
```

SQLite is embedded and stores data directly in `apps/api/data/life.db`. It does not require a separate database server or network connection.

## Initial areas

- Today
- Inbox
- People
- Agent
- World
- Ledger
- Approval center

## Implemented integrations

- Pi through ACP for persistent local agent conversations
- A read-only Apple Reminders MCP server connected through a FastAPI policy gateway, dashboard testing UI, per-tool allowlists, Pi bridge, and ledger events

## MCP request flow

The Agent does not launch external MCP servers directly. It calls the generic `mcp` tool exposed by `.pi/extensions/life-dashboard.ts`. That extension sends the request to FastAPI, which checks that the server is enabled and the requested tool is allowlisted. FastAPI then starts the short-lived Node policy gateway, which launches the configured local MCP executable over stdio, verifies the requested tool is read-only and non-destructive, calls it, and returns bounded JSON. FastAPI records the test or call in the Agent Ledger before returning the result to the Agent.

```text
Agent → life-dashboard extension → FastAPI policy API
      → Node MCP policy gateway → configured local MCP server
      → external service (for example GitHub or Apple Reminders)
```

The gateway is generic; it does not inherently call Apple Reminders. It launches whichever executable is stored in the selected server record. It lives in `apps/mcp-gateway`; it is independent of any particular MCP server and can launch local stdio servers such as GitHub or Apple Reminders. Read-only tools run immediately when allowed. Write tools create an approval card in the Agent panel and are executed only after the user approves the exact server, tool, and arguments.

## Future additions

- A dedicated Autonomous Agents tab with schedules, budgets, checkpoints, approvals, pause/stop controls, and complete ledger visibility
- Permission-gated MCP servers with per-tool allowlists, secret isolation, bounded execution, and approval routing for external side effects
- A People Graph with individual, relationship, and group memory scopes, source provenance, correction, and selective forgetting
- A read-only-first Obsidian “second brain” connector plus permissioned adapters for selected external knowledge sources
- Private push-to-talk voice with local speech processing where practical and explicit opt-in for cloud voice providers
- Portable encrypted export and restore, followed by opt-in Amazon S3, S3-compatible, local-drive, and supported cloud backups
- Repeatable backend, agent-runtime, SQLite, indexing, retrieval, voice, backup/restore, recovery, and frontend benchmarks using synthetic data
- An isolated agent sidecar after benchmark and security validation

These capabilities remain disabled until implemented. See the [future additions roadmap](docs/future-additions.md) for constraints and delivery order.

## Principles

- Local-first personal data
- Explicit approval for external actions
- Minimum necessary context shared with agents
- Agent-agnostic architecture
