#!/bin/sh
set -eu

uv run --frozen --no-dev alembic upgrade head
exec uv run --frozen --no-dev uvicorn app.main:app --host 0.0.0.0 --port 8000
