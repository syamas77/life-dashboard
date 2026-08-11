from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4


@dataclass(slots=True)
class AgentRun:
    id: str
    conversation_id: int
    conversation_title: str
    model: str | None
    status: str
    started_at: datetime

    @property
    def elapsed_seconds(self) -> int:
        return max(1, int((datetime.now(UTC) - self.started_at).total_seconds()))


class AgentRunRegistry:
    """Process-local view of agent prompts currently being executed."""

    def __init__(self) -> None:
        self._runs: dict[str, AgentRun] = {}
        self._lock = Lock()

    def start(
        self,
        *,
        conversation_id: int,
        conversation_title: str,
        model: str | None,
    ) -> AgentRun:
        with self._lock:
            if any(run.conversation_id == conversation_id for run in self._runs.values()):
                raise ValueError("This conversation already has an active agent run.")
            run = AgentRun(
                id=str(uuid4()),
                conversation_id=conversation_id,
                conversation_title=conversation_title,
                model=model,
                status="starting",
                started_at=datetime.now(UTC),
            )
            self._runs[run.id] = run
            return run

    def update(self, run_id: str, status: str) -> None:
        with self._lock:
            if run := self._runs.get(run_id):
                run.status = status

    def finish(self, run_id: str) -> None:
        with self._lock:
            self._runs.pop(run_id, None)

    def list(self) -> list[AgentRun]:
        with self._lock:
            return sorted(self._runs.values(), key=lambda run: run.started_at)
