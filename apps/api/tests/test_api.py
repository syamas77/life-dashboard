from collections.abc import AsyncIterator
from pathlib import Path

from fastapi.testclient import TestClient

from app.agent_runtime import AgentRunRegistry
from app.config import Settings
from app.database import Base
from app.main import create_app
from app.routers import agent as agent_router
from app.routers import mcp as mcp_router


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        mcp_config_path=str(tmp_path / "mcp-servers.json"),
        mcp_gateway_script=str(tmp_path / "gateway.js"),
        mcp_apple_reminders_script=str(tmp_path / "apple-reminders.js"),
    )
    app = create_app(settings)
    return TestClient(app)


def test_health_reports_database_connection(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}


def test_task_lifecycle(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)

        created = client.post(
            "/api/v1/tasks",
            json={"title": "Call Dad", "context": "Family"},
        )
        assert created.status_code == 201
        task_id = created.json()["id"]

        completed = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})
        assert completed.status_code == 200
        assert completed.json()["completed_at"] is not None

        listed = client.get("/api/v1/tasks", params={"completed": True})
        assert [task["title"] for task in listed.json()] == ["Call Dad"]

        deleted = client.delete(f"/api/v1/tasks/{task_id}")
        assert deleted.status_code == 204
        assert client.get(f"/api/v1/tasks/{task_id}").status_code == 404


def test_task_board_status_and_details(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        created = client.post(
            "/api/v1/tasks",
            json={
                "title": "Review email",
                "notes": "Source: https://mail.google.com/mail/u/0/#all/abc",
                "due_at": "2026-08-20T12:00:00Z",
            },
        )
        task_id = created.json()["id"]
        assert created.json()["status"] == "backlog"
        assert created.json()["notes"].startswith("Source:")

        moved = client.patch(f"/api/v1/tasks/{task_id}", json={"status": "in_progress"})
        assert moved.status_code == 200
        assert moved.json()["status"] == "in_progress"
        assert moved.json()["completed_at"] is None

        completed = client.patch(f"/api/v1/tasks/{task_id}", json={"status": "done"})
        assert completed.status_code == 200
        assert completed.json()["status"] == "done"
        assert completed.json()["completed_at"] is not None


def test_agent_status_reports_pinned_adapter(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        response = client.get("/api/v1/agent/status")

    assert response.status_code == 200
    assert response.json()["adapter"] == "pi-acp@0.0.33"


def test_agent_run_registry_tracks_concurrent_conversations() -> None:
    registry = AgentRunRegistry()
    first = registry.start(conversation_id=1, conversation_title="Plan today", model="model-a")
    second = registry.start(conversation_id=2, conversation_title="Family notes", model="model-b")

    registry.update(first.id, "responding")

    assert [run.conversation_id for run in registry.list()] == [1, 2]
    assert registry.list()[0].status == "responding"

    registry.finish(first.id)
    registry.finish(second.id)
    assert registry.list() == []


def test_agent_configuration_returns_pi_options(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_configuration(_settings: Settings) -> dict[str, object]:
        return {
            "options": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "current_value": "openai/gpt-test",
                    "options": [
                        {
                            "value": "openai/gpt-test",
                            "name": "openai/Test",
                            "description": None,
                        }
                    ],
                }
            ]
        }

    monkeypatch.setattr(agent_router, "get_pi_configuration", fake_configuration)
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        response = client.get("/api/v1/agent/configuration")

    assert response.status_code == 200
    assert response.json()["options"][0]["current_value"] == "openai/gpt-test"


def test_agent_prompt_streams_server_sent_events(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_stream(
        _settings: Settings,
        prompt: str,
        model: str | None = None,
        thinking_level: str | None = None,
        session_id: str | None = None,
    ) -> AsyncIterator[dict[str, object]]:
        assert prompt == "Remember to call Dad"
        assert model == "openai/gpt-test"
        assert thinking_level == "low"
        assert session_id is None
        yield {"type": "session", "session_id": "acp-session-1"}
        yield {
            "type": "tool_start",
            "tool_call_id": "tool-1",
            "title": "inbox_create",
            "raw_input": {"content": "Call Dad"},
        }
        yield {
            "type": "tool_update",
            "tool_call_id": "tool-1",
            "title": None,
            "status": "completed",
            "raw_output": {"itemId": 42},
        }
        yield {"type": "text_delta", "delta": "Saved it."}
        yield {"type": "done", "stop_reason": "end_turn"}

    monkeypatch.setattr(agent_router, "stream_pi_prompt", fake_stream)

    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        conversation = client.post("/api/v1/agent/conversations", json={}).json()
        response = client.post(
            "/api/v1/agent/prompt",
            json={
                "conversation_id": conversation["id"],
                "prompt": "Remember to call Dad",
                "model": "openai/gpt-test",
                "thinking_level": "low",
            },
        )
        messages = client.get(f"/api/v1/agent/conversations/{conversation['id']}/messages").json()
        saved_conversation = client.get("/api/v1/agent/conversations").json()[0]
        active_runs = client.get("/api/v1/agent/runs").json()
        ledger = client.get("/api/v1/agent/ledger").json()
        client.delete(f"/api/v1/agent/conversations/{conversation['id']}")
        preserved_ledger = client.get("/api/v1/agent/ledger").json()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: text_delta" in response.text
    assert '"delta":"Saved it."' in response.text
    assert "event: done" in response.text
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[1]["content"] == "Saved it."
    assert saved_conversation["acp_session_id"] == "acp-session-1"
    assert saved_conversation["title"] == "Remember to call Dad"
    assert active_runs == []
    assert [entry["event_type"] for entry in reversed(ledger)] == [
        "run_started",
        "session_connected",
        "tool_started",
        "tool_completed",
        "run_completed",
    ]
    assert ledger[1]["tool_name"] == "inbox_create"
    assert ledger[1]["output_json"] == '{"itemId":42}'
    assert all(entry["conversation_id"] is None for entry in preserved_ledger)
    assert all(entry["conversation_title"] == "Deleted conversation" for entry in preserved_ledger)


def test_mcp_server_can_be_added_tested_allowed_and_called(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_gateway(_settings, _server, *, action, tool=None, arguments=None):  # type: ignore[no-untyped-def]
        if action == "inspect":
            return {
                "tools": [
                    {
                        "name": "read_notes",
                        "title": "Read notes",
                        "description": "Read selected notes",
                        "inputSchema": {"type": "object"},
                        "annotations": {
                            "readOnlyHint": True,
                            "destructiveHint": False,
                        },
                    }
                ],
                "truncated": False,
            }
        assert tool == "read_notes"
        assert arguments == {"limit": 2}
        return {
            "isError": False,
            "content": [{"type": "text", "text": "two notes"}],
            "structuredContent": {"count": 2},
        }

    monkeypatch.setattr(mcp_router, "run_mcp_gateway", fake_gateway)
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)
        rejected = client.post(
            "/api/v1/mcp/servers",
            json={"name": "Notes", "command": "/usr/bin/true", "confirmed_risk": False},
        )
        created = client.post(
            "/api/v1/mcp/servers",
            json={"name": "Notes", "command": "/usr/bin/true", "confirmed_risk": True},
        )
        server_id = created.json()["id"]
        tested = client.post(f"/api/v1/mcp/servers/{server_id}/test")
        configured = client.patch(
            f"/api/v1/mcp/servers/{server_id}",
            json={"enabled": True, "allowed_tools": ["read_notes"]},
        )
        called = client.post(
            f"/api/v1/mcp/servers/{server_id}/tools/read_notes/call",
            json={"arguments": {"limit": 2}},
        )
        ledger = client.get("/api/v1/agent/ledger").json()

    assert rejected.status_code == 400
    assert created.status_code == 201
    assert created.json()["enabled"] is False
    assert tested.status_code == 200
    assert tested.json()["tools"][0]["read_only"] is True
    assert configured.json()["allowed_tools"] == ["read_notes"]
    assert called.status_code == 200
    assert called.json()["structured_content"] == {"count": 2}
    assert [entry["event_type"] for entry in reversed(ledger)] == [
        "mcp_server_tested",
        "mcp_tool_called",
    ]


def test_inbox_item_can_be_processed(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        Base.metadata.create_all(client.app.state.engine)

        created = client.post("/api/v1/inbox", json={"content": "Renew passport"})
        assert created.status_code == 201
        item_id = created.json()["id"]

        processed = client.patch(f"/api/v1/inbox/{item_id}", json={"processed": True})
        assert processed.status_code == 200
        assert processed.json()["processed_at"] is not None
