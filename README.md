# Life Dashboard

A local-first personal operating system for managing daily life with agent assistance.

## Vision

Bring schedules, priorities, notes, relationships, goals, and personal context into one calm dashboard. Agents connect through ACP and remain interchangeable rather than owning the underlying data.

## Planned stack

- **Web:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- **API:** FastAPI, Pydantic, SQLAlchemy, Alembic
- **Storage:** SQLite locally, with a path to PostgreSQL
- **Agents:** Adapter layer supporting Codex ACP and future ACP-compatible agents

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
