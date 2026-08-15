import asyncio
import contextlib
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from acp import PROTOCOL_VERSION, Client, RequestError, spawn_agent_process, text_block
from acp.client.connection import ClientSideConnection
from acp.schema import (
    AgentMessageChunk,
    AgentPlanContentUpdate,
    AgentPlanRemovedUpdate,
    AgentPlanUpdate,
    AgentThoughtChunk,
    AvailableCommandsUpdate,
    ClientCapabilities,
    ConfigOptionUpdate,
    CreateElicitationResponse,
    CreateTerminalResponse,
    CurrentModeUpdate,
    DeclineElicitationResponse,
    DeniedOutcome,
    ElicitationMode,
    EnvVariable,
    Implementation,
    KillTerminalResponse,
    PermissionOption,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    RequestPermissionResponse,
    SessionConfigOptionSelect,
    SessionConfigSelectOption,
    SessionInfoUpdate,
    TerminalOutputResponse,
    TextContentBlock,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
    UsageUpdate,
    UserMessageChunk,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)

from app.config import Settings

AgentStreamEvent = dict[str, Any]


def delete_pi_session_artifacts(session_id: str | None) -> None:
    """Remove the ACP mapping and underlying Pi JSONL session for a conversation."""
    if not session_id:
        return
    map_path = Path.home() / ".pi" / "pi-acp" / "session-map.json"
    if not map_path.is_file():
        return
    try:
        payload = json.loads(map_path.read_text(encoding="utf-8"))
        entry = payload.get("sessions", {}).pop(session_id, None)
        if entry and isinstance(entry.get("sessionFile"), str):
            session_path = Path(entry["sessionFile"])
            if session_path.is_file():
                session_path.unlink()
        map_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    except (OSError, TypeError, ValueError):
        # Database deletion should still succeed if an old/malformed ACP map cannot be cleaned.
        return


def _bounded_json_value(value: Any, limit: int = 8000) -> Any:
    if value is None:
        return None
    serialized = json.dumps(value, default=str, separators=(",", ":"))
    if len(serialized) <= limit:
        return json.loads(serialized)
    return {"truncated": True, "preview": serialized[:limit]}


class LifeDashboardAcpClient(Client):
    """Minimal, deny-by-default ACP client used by the local API."""

    def __init__(self) -> None:
        self.events: asyncio.Queue[AgentStreamEvent] = asyncio.Queue()

    async def request_permission(
        self,
        session_id: str,
        tool_call: ToolCallUpdate,
        options: list[PermissionOption],
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        await self.events.put(
            {
                "type": "permission_denied",
                "title": tool_call.title or "Agent permission request",
            }
        )
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def session_update(
        self,
        session_id: str,
        update: UserMessageChunk
        | AgentMessageChunk
        | AgentThoughtChunk
        | ToolCallStart
        | ToolCallProgress
        | AgentPlanUpdate
        | AgentPlanContentUpdate
        | AgentPlanRemovedUpdate
        | AvailableCommandsUpdate
        | CurrentModeUpdate
        | ConfigOptionUpdate
        | SessionInfoUpdate
        | UsageUpdate,
        **kwargs: Any,
    ) -> None:
        if isinstance(update, AgentMessageChunk) and isinstance(update.content, TextContentBlock):
            await self.events.put({"type": "text_delta", "delta": update.content.text})
        elif isinstance(update, ToolCallStart):
            await self.events.put(
                {
                    "type": "tool_start",
                    "tool_call_id": update.tool_call_id,
                    "title": update.title,
                    "kind": update.kind,
                    "status": update.status,
                    "raw_input": _bounded_json_value(update.raw_input),
                }
            )
        elif isinstance(update, ToolCallProgress):
            await self.events.put(
                {
                    "type": "tool_update",
                    "tool_call_id": update.tool_call_id,
                    "status": update.status,
                    "title": update.title,
                    "kind": update.kind,
                    "raw_input": _bounded_json_value(update.raw_input),
                    "raw_output": _bounded_json_value(update.raw_output),
                }
            )

    async def write_text_file(
        self, session_id: str, path: str, content: str, **kwargs: Any
    ) -> WriteTextFileResponse | None:
        raise RequestError.method_not_found("fs/write_text_file")

    async def read_text_file(
        self,
        session_id: str,
        path: str,
        line: int | None = None,
        limit: int | None = None,
        **kwargs: Any,
    ) -> ReadTextFileResponse:
        raise RequestError.method_not_found("fs/read_text_file")

    async def create_terminal(
        self,
        session_id: str,
        command: str,
        args: list[str] | None = None,
        env: list[EnvVariable] | None = None,
        cwd: str | None = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> CreateTerminalResponse:
        raise RequestError.method_not_found("terminal/create")

    async def terminal_output(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> TerminalOutputResponse:
        raise RequestError.method_not_found("terminal/output")

    async def release_terminal(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> ReleaseTerminalResponse | None:
        raise RequestError.method_not_found("terminal/release")

    async def wait_for_terminal_exit(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> WaitForTerminalExitResponse:
        raise RequestError.method_not_found("terminal/wait_for_exit")

    async def kill_terminal(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> KillTerminalResponse | None:
        raise RequestError.method_not_found("terminal/kill")

    async def create_elicitation(
        self, message: str, mode: ElicitationMode, **kwargs: Any
    ) -> CreateElicitationResponse:
        return DeclineElicitationResponse(action="decline")

    async def complete_elicitation(self, elicitation_id: str, **kwargs: Any) -> None:
        return None

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        raise RequestError.method_not_found(method)

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        return None


def _agent_process_configuration(settings: Settings) -> tuple[str, dict[str, str]]:
    command = Path(settings.agent_command)
    pi_command = Path(settings.agent_pi_command)
    if not command.is_file():
        raise RuntimeError(f"pi-acp is not installed at {command}. Run npm install in apps/agent.")
    if not pi_command.is_file():
        raise RuntimeError(f"The restricted Pi launcher is missing at {pi_command}.")

    environment = os.environ.copy()
    environment.update(
        {
            "PI_ACP_PI_COMMAND": str(pi_command),
            "LIFE_API_INTERNAL_URL": settings.agent_internal_api_url,
        }
    )
    return str(command), environment


@asynccontextmanager
async def open_pi_session(
    settings: Settings,
    session_id: str | None = None,
) -> AsyncIterator[
    tuple[LifeDashboardAcpClient, ClientSideConnection, str, list[SessionConfigOptionSelect]]
]:
    command, environment = _agent_process_configuration(settings)
    client = LifeDashboardAcpClient()
    async with spawn_agent_process(
        client,
        command,
        env=environment,
        cwd=settings.agent_cwd,
    ) as (connection, _process):
        await connection.initialize(
            protocol_version=PROTOCOL_VERSION,
            client_capabilities=ClientCapabilities(),
            client_info=Implementation(
                name="life-dashboard",
                title="Life Dashboard",
                version="0.1.0",
            ),
        )
        if session_id:
            session = await connection.load_session(
                session_id=session_id,
                mcp_servers=[],
                cwd=settings.agent_cwd,
            )
            resolved_session_id = session_id
            while not client.events.empty():
                client.events.get_nowait()
        else:
            session = await connection.new_session(mcp_servers=[], cwd=settings.agent_cwd)
            resolved_session_id = session.session_id

        configs = [
            option
            for option in session.config_options or []
            if isinstance(option, SessionConfigOptionSelect)
        ]
        yield client, connection, resolved_session_id, configs


def _select_options(config: SessionConfigOptionSelect) -> list[dict[str, str | None]]:
    return [
        {"value": option.value, "name": option.name, "description": option.description}
        for option in config.options
        if isinstance(option, SessionConfigSelectOption)
    ]


async def get_pi_configuration(settings: Settings) -> dict[str, object]:
    async with asyncio.timeout(settings.agent_timeout_seconds):
        async with open_pi_session(settings) as (_client, _connection, _session_id, configs):
            options = [
                {
                    "id": option.id,
                    "name": option.name,
                    "category": option.category if isinstance(option.category, str) else None,
                    "current_value": option.current_value,
                    "options": _select_options(option),
                }
                for option in configs
            ]
            return {"options": options}


def _find_config(
    configs: list[SessionConfigOptionSelect], config_id: str
) -> SessionConfigOptionSelect | None:
    return next((config for config in configs if config.id == config_id), None)


async def _apply_config_option(
    connection: ClientSideConnection,
    session_id: str,
    config: SessionConfigOptionSelect | None,
    value: str | None,
) -> None:
    if value is None:
        return
    if config is None:
        raise ValueError(f"The agent does not provide the {value!r} configuration option.")
    allowed_values = {option["value"] for option in _select_options(config)}
    if value not in allowed_values:
        raise ValueError(f"Unsupported value {value!r} for {config.name}.")
    await connection.set_config_option(session_id=session_id, config_id=config.id, value=value)


async def stream_pi_prompt(
    settings: Settings,
    prompt: str,
    model: str | None = None,
    thinking_level: str | None = None,
    session_id: str | None = None,
) -> AsyncIterator[AgentStreamEvent]:
    async with asyncio.timeout(settings.agent_timeout_seconds):
        async with open_pi_session(settings, session_id) as (
            client,
            connection,
            resolved_session_id,
            configs,
        ):
            yield {"type": "session", "session_id": resolved_session_id}
            await _apply_config_option(
                connection, resolved_session_id, _find_config(configs, "model"), model
            )
            await _apply_config_option(
                connection,
                resolved_session_id,
                _find_config(configs, "thought_level"),
                thinking_level,
            )

            prompt_task = asyncio.create_task(
                connection.prompt(session_id=resolved_session_id, prompt=[text_block(prompt)])
            )
            try:
                while not prompt_task.done() or not client.events.empty():
                    try:
                        event = await asyncio.wait_for(client.events.get(), timeout=0.1)
                    except TimeoutError:
                        continue
                    yield event

                response = await prompt_task
                yield {"type": "done", "stop_reason": response.stop_reason}
            finally:
                if not prompt_task.done():
                    prompt_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await prompt_task
