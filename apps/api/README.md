# Life Dashboard API

Local FastAPI service backed by an embedded SQLite database.

## Local development

Install the pinned Pi ACP bridge once:

```bash
cd ../agent
npm install
cd ../api
```

Then start the API:

```bash
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

The service is available at:

- API: http://127.0.0.1:8000
- Interactive documentation: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/health
- Agent status: http://127.0.0.1:8000/api/v1/agent/status
- Pi models and thinking options: http://127.0.0.1:8000/api/v1/agent/configuration
- Saved conversations: http://127.0.0.1:8000/api/v1/agent/conversations

By default, personal data is stored in `data/life.db`. This file is ignored by Git.

The agent endpoint uses the official Python ACP SDK to launch the pinned `pi-acp` adapter. The restricted launcher at `.pi/bin/life-pi` enables only the project-owned `inbox_create` tool. Pi must already be installed and authenticated on the machine.

Agent conversation metadata and visible messages are stored in SQLite. The ACP session ID reconnects each conversation to Pi's persisted JSONL context, allowing later requests and application restarts to resume the same session.

## Checks

```bash
uv run ruff check .
uv run pytest
```

## Migrations

After changing SQLAlchemy models, create and apply a migration:

```bash
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

## Docker

The image runs migrations before starting the API and stores SQLite at `/data/life.db`.
Always mount `/data` as a persistent volume. When published from Docker, bind port 8000 to
`127.0.0.1` unless another trusted device on the local network needs access.

```bash
docker build -t life-dashboard-api .
docker run --rm \
  -p 127.0.0.1:8000:8000 \
  -v life-dashboard-data:/data \
  life-dashboard-api
```

The current API image does not yet bundle Node.js, Pi, provider credentials, or `pi-acp`, so agent prompts are unavailable inside that container. A later agent sidecar will handle those dependencies. The Docker setup cannot be tested on this machine until Docker is installed.
