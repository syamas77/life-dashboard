"""add conversation archival

Revision ID: 8b3d9e1f4a20
Revises: 7f2e1d4c9a10
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "8b3d9e1f4a20"
down_revision: str | Sequence[str] | None = "7f2e1d4c9a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_conversations", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_conversations", "archived_at")
