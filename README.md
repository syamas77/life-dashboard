# Life Dashboard

A local-first personal operating system for managing daily life with agent assistance.

## Vision

Bring schedules, priorities, notes, relationships, goals, and personal context into one calm dashboard. Agents connect through ACP and remain interchangeable rather than owning the underlying data.

## Planned stack

- **Web:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- **API:** FastAPI, Pydantic, SQLAlchemy, Alembic
- **Storage:** SQLite locally, with a path to PostgreSQL
- **Agents:** Adapter layer supporting Codex ACP and future ACP-compatible agents

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for Mermaid diagrams covering the local application, request flow, Docker direction, and database migrations.

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
- Approval center

## Principles

- Local-first personal data
- Explicit approval for external actions
- Minimum necessary context shared with agents
- Agent-agnostic architecture
