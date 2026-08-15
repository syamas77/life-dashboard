from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import uuid4


@dataclass
class PendingMcpApproval:
    id: str
    server_id: str
    server_name: str
    tool_name: str
    arguments: dict[str, Any]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    status: str = "pending"
    decision: asyncio.Future[str] | None = field(default=None, repr=False)
    result: dict[str, Any] | None = None
    error: str | None = None


class McpApprovalStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._items: dict[str, PendingMcpApproval] = {}

    def create(
        self,
        *,
        server_id: str,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any],
        decision: asyncio.Future[str],
    ) -> PendingMcpApproval:
        item = PendingMcpApproval(
            id=str(uuid4()),
            server_id=server_id,
            server_name=server_name,
            tool_name=tool_name,
            arguments=arguments,
            decision=decision,
        )
        with self._lock:
            self._items[item.id] = item
        return item

    def get(self, approval_id: str) -> PendingMcpApproval | None:
        with self._lock:
            return self._items.get(approval_id)

    def list_pending(self) -> list[PendingMcpApproval]:
        with self._lock:
            return [item for item in self._items.values() if item.status == "pending"]

    def resolve(self, approval_id: str, decision: str) -> PendingMcpApproval:
        with self._lock:
            item = self._items[approval_id]
            if item.status != "pending":
                return item
            item.status = decision
            if item.decision is not None and not item.decision.done():
                item.decision.set_result(decision)
            return item

    def finish(
        self,
        approval_id: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> PendingMcpApproval:
        with self._lock:
            item = self._items[approval_id]
            item.status = status
            item.result = result
            item.error = error
            return item


store = McpApprovalStore()
