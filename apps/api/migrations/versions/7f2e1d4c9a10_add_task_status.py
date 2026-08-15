"""add task status

Revision ID: 7f2e1d4c9a10
Revises: 50d8f5c89bed
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "7f2e1d4c9a10"
down_revision: str | Sequence[str] | None = "50d8f5c89bed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "status" not in {column["name"] for column in inspector.get_columns("tasks")}:
        op.add_column("tasks", sa.Column("status", sa.String(length=20), nullable=True, server_default="backlog"))
    op.execute("UPDATE tasks SET status = CASE WHEN completed_at IS NOT NULL THEN 'done' ELSE 'backlog' END WHERE status IS NULL")


def downgrade() -> None:
    op.drop_column("tasks", "status")
