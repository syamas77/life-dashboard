from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    context: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="backlog")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentConversation(TimestampMixin, Base):
    __tablename__ = "agent_conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    acp_session_id: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    model: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thinking_level: Mapped[str | None] = mapped_column(String(40), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    messages: Mapped[list["AgentMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AgentMessage.created_at",
    )
    ledger_entries: Mapped[list["AgentLedgerEntry"]] = relationship(
        back_populates="conversation",
        passive_deletes=True,
        order_by="AgentLedgerEntry.created_at",
    )


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("agent_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    conversation: Mapped[AgentConversation] = relationship(back_populates="messages")


class AgentLedgerEntry(Base):
    __tablename__ = "agent_ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    acp_session_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(String(300))
    model: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thinking_level: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    tool_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    input_json: Mapped[str | None] = mapped_column(Text(), nullable=True)
    output_json: Mapped[str | None] = mapped_column(Text(), nullable=True)
    error: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    conversation: Mapped[AgentConversation | None] = relationship(back_populates="ledger_entries")

    @property
    def conversation_title(self) -> str:
        return self.conversation.title if self.conversation else "Deleted conversation"


class InboxItem(TimestampMixin, Base):
    __tablename__ = "inbox_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
