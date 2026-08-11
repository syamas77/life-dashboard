import json
import os
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from app.config import Settings


class McpServerRecord(BaseModel):
    id: str
    name: str
    command: str
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    enabled: bool = False
    built_in: bool = False
    allowed_tools: list[str] = Field(default_factory=list)
    discovered_tools: list[dict[str, Any]] = Field(default_factory=list)
    last_tested_at: datetime | None = None
    last_error: str | None = None


class McpServerStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.path = Path(settings.mcp_config_path)
        self.lock = threading.Lock()

    def list(self) -> list[McpServerRecord]:
        with self.lock:
            records = self._read()
            if records:
                return records
            bundled = self._bundled_apple_server()
            if bundled is None:
                return []
            self._write([bundled])
            return [bundled]

    def get(self, server_id: str) -> McpServerRecord | None:
        return next((record for record in self.list() if record.id == server_id), None)

    def add(self, record: McpServerRecord) -> McpServerRecord:
        with self.lock:
            records = self._read()
            records.append(record)
            self._write(records)
        return record

    def update(self, updated: McpServerRecord) -> McpServerRecord:
        with self.lock:
            records = self._read()
            for index, record in enumerate(records):
                if record.id == updated.id:
                    records[index] = updated
                    self._write(records)
                    return updated
        raise KeyError(updated.id)

    def delete(self, server_id: str) -> None:
        with self.lock:
            records = self._read()
            matched = next((record for record in records if record.id == server_id), None)
            if matched is None:
                raise KeyError(server_id)
            if matched.built_in:
                raise ValueError("Bundled MCP servers cannot be deleted; disable them instead.")
            self._write([record for record in records if record.id != server_id])

    def create_custom(
        self,
        *,
        name: str,
        command: str,
        args: list[str],
        cwd: str | None,
    ) -> McpServerRecord:
        return self.add(
            McpServerRecord(
                id=str(uuid4()),
                name=name,
                command=command,
                args=args,
                cwd=cwd,
            )
        )

    def _read(self) -> list[McpServerRecord]:
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return [McpServerRecord.model_validate(item) for item in payload]
        except (OSError, ValueError, TypeError) as error:
            raise RuntimeError(f"MCP server configuration could not be read: {error}") from error

    def _write(self, records: list[McpServerRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        payload = [record.model_dump(mode="json") for record in records]
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.path)

    def _bundled_apple_server(self) -> McpServerRecord | None:
        node_command = shutil.which(self.settings.mcp_node_command)
        server_script = Path(self.settings.mcp_apple_reminders_script)
        if node_command is None or not server_script.is_file():
            return None
        return McpServerRecord(
            id="apple-reminders",
            name="Apple Reminders",
            command=str(Path(node_command).resolve()),
            args=[str(server_script.resolve())],
            cwd=str(server_script.parents[2]),
            enabled=True,
            built_in=True,
            allowed_tools=["apple_reminders_list_lists", "apple_reminders_list"],
        )


def utc_now() -> datetime:
    return datetime.now(UTC)
