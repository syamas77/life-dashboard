import asyncio
import json
import os
import signal
from pathlib import Path
from typing import Any

from app.config import Settings
from app.mcp_config import McpServerRecord


class McpGatewayError(RuntimeError):
    pass


async def run_mcp_gateway(
    settings: Settings,
    server: McpServerRecord,
    *,
    action: str,
    tool: str | None = None,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    gateway_script = Path(settings.mcp_gateway_script)
    if not gateway_script.is_file():
        raise McpGatewayError(
            "The MCP policy gateway is not built. Run npm run build in "
            "apps/mcp-apple-reminders."
        )

    payload: dict[str, Any] = {
        "action": action,
        "server": {
            "command": server.command,
            "args": server.args,
            "cwd": server.cwd,
            "allowedTools": server.allowed_tools,
        },
    }
    if action == "call":
        payload["tool"] = tool
        payload["arguments"] = arguments or {}

    process = await asyncio.create_subprocess_exec(
        settings.mcp_node_command,
        str(gateway_script),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(json.dumps(payload).encode()),
            timeout=settings.mcp_timeout_seconds,
        )
    except TimeoutError as error:
        _kill_process_group(process.pid)
        await process.wait()
        raise McpGatewayError("The MCP server test timed out.") from error

    if len(stdout) > 2_097_152 or len(stderr) > 65_536:
        raise McpGatewayError("The MCP server returned too much data.")
    if process.returncode != 0:
        detail = stderr.decode(errors="replace").strip()[-1000:]
        raise McpGatewayError(detail or "The MCP server exited before completing the request.")

    try:
        result = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise McpGatewayError("The MCP policy gateway returned invalid JSON.") from error
    if not isinstance(result, dict):
        raise McpGatewayError("The MCP policy gateway returned an invalid result.")
    return result


def _kill_process_group(pid: int | None) -> None:
    if pid is None:
        return
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
