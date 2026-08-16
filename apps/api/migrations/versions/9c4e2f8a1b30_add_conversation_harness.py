"""add conversation harness

Revision ID: 9c4e2f8a1b30
Revises: 8b3d9e1f4a20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "9c4e2f8a1b30"
down_revision: str | Sequence[str] | None = "8b3d9e1f4a20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_conversations", sa.Column("harness", sa.String(length=40), nullable=True, server_default="pi"))
    op.execute("UPDATE agent_conversations SET harness = 'pi' WHERE harness IS NULL")


def downgrade() -> None:
    op.drop_column("agent_conversations", "harness")
