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

## Future additions

- A dedicated Autonomous Agents tab with schedules, budgets, checkpoints, approvals, pause/stop controls, and complete ledger visibility
- Permission-gated MCP servers with per-tool allowlists, secret isolation, bounded execution, and approval routing for external side effects
- A People Graph with individual, relationship, and group memory scopes, source provenance, correction, and selective forgetting
- A read-only-first Obsidian “second brain” connector plus permissioned adapters for selected external knowledge sources
- Repeatable backend, agent-runtime, SQLite, indexing, retrieval, recovery, and frontend benchmarks using synthetic data
- An isolated agent sidecar and encrypted opt-in backups after benchmark and security validation

These capabilities remain disabled until implemented. See the [future additions roadmap](docs/future-additions.md) for constraints and delivery order.

## Principles

- Local-first personal data
- Explicit approval for external actions
- Minimum necessary context shared with agents
- Agent-agnostic architecture
