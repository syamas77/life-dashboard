import asyncio
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status

from app.config import Settings
from app.database import SessionDep
from app.mcp_approvals import store as approval_store
from app.mcp_config import McpServerRecord, McpServerStore, utc_now
from app.mcp_gateway import McpGatewayError, run_mcp_gateway
from app.models import AgentLedgerEntry
from app.schemas import (
    McpApprovalRead,
    McpServerCreate,
    McpServerRead,
    McpServerTestRead,
    McpServerUpdate,
    McpToolCall,
    McpToolCallRead,
    McpToolRead,
)

router = APIRouter(prefix="/mcp", tags=["mcp"])


def store_from(request: Request) -> McpServerStore:
    return request.app.state.mcp_servers


def settings_from(request: Request) -> Settings:
    return request.app.state.settings


def find_server(request: Request, server_id: str) -> McpServerRecord:
    server = store_from(request).get(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    return server


def tool_view(tool: dict[str, Any]) -> McpToolRead:
    annotations = tool.get("annotations") or {}
    return McpToolRead(
        name=str(tool.get("name") or ""),
        title=tool.get("title"),
        description=tool.get("description"),
        input_schema=tool.get("inputSchema") or {},
        read_only=annotations.get("readOnlyHint") is True,
        destructive=annotations.get("destructiveHint") is True,
    )


def ledger_value(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)[:8000]


def record_event(
    session: SessionDep,
    *,
    event_type: str,
    status_value: str,
    summary: str,
    tool_name: str | None = None,
    input_value: object | None = None,
    output_value: object | None = None,
    error: str | None = None,
) -> None:
    session.add(
        AgentLedgerEntry(
            run_id=str(uuid4()),
            event_type=event_type,
            status=status_value,
            summary=summary,
            tool_name=tool_name,
            input_json=ledger_value(input_value) if input_value is not None else None,
            output_json=ledger_value(output_value) if output_value is not None else None,
            error=error[:2000] if error else None,
        )
    )
    session.commit()


async def execute_mcp_call(
    request: Request,
    session: SessionDep,
    server: McpServerRecord,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    approval_id: str | None = None,
) -> McpToolCallRead:
    result = await run_mcp_gateway(
        settings_from(request),
        server,
        action="call",
        tool=tool_name,
        arguments=arguments,
    )
    is_error = result.get("isError") is True
    record_event(
        session,
        event_type="mcp_tool_called",
        status_value="failed" if is_error else "completed",
        summary=f"MCP tool called: {server.name} / {tool_name}",
        tool_name=tool_name,
        input_value=arguments,
        output_value=result,
    )
    if approval_id:
        approval_store.finish(
            approval_id,
            status="completed" if not is_error else "failed",
            result=result,
        )
    return McpToolCallRead(
        is_error=is_error,
        content=result.get("content") if isinstance(result.get("content"), list) else [],
        structured_content=(
            result.get("structuredContent")
            if isinstance(result.get("structuredContent"), dict)
            else None
        ),
    )


@router.get("/servers", response_model=list[McpServerRead])
def list_mcp_servers(request: Request) -> list[McpServerRecord]:
    return store_from(request).list()


@router.post(
    "/servers",
    response_model=McpServerRead,
    status_code=status.HTTP_201_CREATED,
)
def add_mcp_server(payload: McpServerCreate, request: Request) -> McpServerRecord:
    if not payload.confirmed_risk:
        raise HTTPException(
            status_code=400,
            detail=(
                "Confirm that adding a local MCP server executes trusted code with your "
                "user permissions."
            ),
        )
    command = Path(payload.command).expanduser()
    if not command.is_absolute() or not command.is_file() or not os.access(command, os.X_OK):
        raise HTTPException(status_code=400, detail="Command must be an absolute executable file.")
    if any(len(argument) > 1000 for argument in payload.args):
        raise HTTPException(
            status_code=400,
            detail="Each MCP argument must be 1000 characters or fewer.",
        )
    cwd = Path(payload.cwd).expanduser() if payload.cwd else None
    if cwd is not None and (not cwd.is_absolute() or not cwd.is_dir()):
        raise HTTPException(
            status_code=400,
            detail="Working directory must be an absolute directory.",
        )
    return store_from(request).create_custom(
        name=payload.name.strip(),
        command=str(command.resolve()),
        args=payload.args,
        cwd=str(cwd.resolve()) if cwd else None,
    )


@router.patch("/servers/{server_id}", response_model=McpServerRead)
def update_mcp_server(
    server_id: str,
    payload: McpServerUpdate,
    request: Request,
) -> McpServerRecord:
    server = find_server(request, server_id)
    if payload.allowed_tools is not None:
        discovered = {tool.name: tool for tool in map(tool_view, server.discovered_tools)}
        unknown = [name for name in payload.allowed_tools if name not in discovered]
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Test the server before allowing: {', '.join(unknown)}",
            )
        server.allowed_tools = list(dict.fromkeys(payload.allowed_tools))
    if payload.enabled is not None:
        server.enabled = payload.enabled
    return store_from(request).update(server)


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(server_id: str, request: Request) -> None:
    try:
        store_from(request).delete(server_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="MCP server not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/servers/{server_id}/test", response_model=McpServerTestRead)
async def test_mcp_server(
    server_id: str,
    request: Request,
    session: SessionDep,
) -> McpServerTestRead:
    server = find_server(request, server_id)
    try:
        result = await run_mcp_gateway(settings_from(request), server, action="inspect")
        raw_tools = result.get("tools") if isinstance(result.get("tools"), list) else []
        server.discovered_tools = [tool for tool in raw_tools if isinstance(tool, dict)][:100]
        server.last_tested_at = utc_now()
        server.last_error = None
        store_from(request).update(server)
        tools = [tool_view(tool) for tool in server.discovered_tools]
        record_event(
            session,
            event_type="mcp_server_tested",
            status_value="completed",
            summary=f"MCP server tested: {server.name}",
            output_value={"server_id": server.id, "tool_count": len(tools)},
        )
        return McpServerTestRead(
            server=McpServerRead.model_validate(server),
            tools=tools,
            truncated=result.get("truncated") is True,
        )
    except McpGatewayError as error:
        server.last_tested_at = utc_now()
        server.last_error = str(error)[:1000]
        store_from(request).update(server)
        record_event(
            session,
            event_type="mcp_server_tested",
            status_value="failed",
            summary=f"MCP server test failed: {server.name}",
            error=str(error),
        )
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post(
    "/servers/{server_id}/tools/{tool_name}/call",
    response_model=McpToolCallRead,
)
async def call_mcp_tool(
    server_id: str,
    tool_name: str,
    payload: McpToolCall,
    request: Request,
    session: SessionDep,
) -> McpToolCallRead:
    server = find_server(request, server_id)
    if not server.enabled:
        raise HTTPException(status_code=409, detail="This MCP server is disabled.")
    if tool_name not in server.allowed_tools:
        raise HTTPException(status_code=403, detail="This MCP tool is not allowed.")
    discovered = next(
        (tool for tool in server.discovered_tools if tool.get("name") == tool_name),
        None,
    )
    annotations = discovered.get("annotations") or {} if discovered else {}
    is_read_only = (
        annotations.get("readOnlyHint") is True
        and annotations.get("destructiveHint") is not True
    )
    if not is_read_only:
        decision_future = asyncio.get_running_loop().create_future()
        approval = approval_store.create(
            server_id=server.id,
            server_name=server.name,
            tool_name=tool_name,
            arguments=payload.arguments,
            decision=decision_future,
        )
        record_event(
            session,
            event_type="mcp_approval_requested",
            status_value="pending",
            summary=f"Approval requested: {server.name} / {tool_name}",
            tool_name=tool_name,
            input_value=payload.arguments,
        )
        try:
            decision = await asyncio.wait_for(
                asyncio.shield(decision_future),
                timeout=300,
            )
        except TimeoutError:
            approval_store.finish(approval.id, status="expired", error="Approval timed out.")
            record_event(
                session,
                event_type="mcp_approval_expired",
                status_value="failed",
                summary=f"MCP approval expired: {server.name} / {tool_name}",
                tool_name=tool_name,
                input_value=payload.arguments,
                error="Approval timed out.",
            )
            return McpToolCallRead(
                is_error=True,
                content=[
                    {
                        "type": "text",
                        "text": "The approval request expired without a response.",
                    }
                ],
                structured_content=None,
            )
        if decision != "approved":
            approval_store.finish(approval.id, status="rejected")
            return McpToolCallRead(
                is_error=True,
                content=[{"type": "text", "text": "The user rejected this MCP action."}],
                structured_content=None,
            )
        try:
            return await execute_mcp_call(
                request,
                session,
                server,
                tool_name,
                payload.arguments,
                approval_id=approval.id,
            )
        except McpGatewayError as error:
            approval_store.finish(approval.id, status="failed", error=str(error))
            raise HTTPException(status_code=502, detail=str(error)) from error
    try:
        return await execute_mcp_call(request, session, server, tool_name, payload.arguments)
    except McpGatewayError as error:
        record_event(
            session,
            event_type="mcp_tool_called",
            status_value="failed",
            summary=f"MCP tool failed: {server.name} / {tool_name}",
            tool_name=tool_name,
            input_value=payload.arguments,
            error=str(error),
        )
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/approvals", response_model=list[McpApprovalRead])
def list_mcp_approvals() -> list[McpApprovalRead]:
    return [
        McpApprovalRead.model_validate(item, from_attributes=True)
        for item in approval_store.list_pending()
    ]


@router.post("/approvals/{approval_id}/reject", response_model=McpApprovalRead)
def reject_mcp_approval(approval_id: str, session: SessionDep) -> McpApprovalRead:
    approval = approval_store.get(approval_id)
    if approval is None:
        raise HTTPException(status_code=404, detail="MCP approval not found.")
    approval_store.resolve(approval_id, "rejected")
    record_event(
        session,
        event_type="mcp_approval_rejected",
        status_value="completed",
        summary=f"MCP approval rejected: {approval.server_name} / {approval.tool_name}",
        tool_name=approval.tool_name,
        input_value=approval.arguments,
    )
    return McpApprovalRead.model_validate(approval, from_attributes=True)


@router.post("/approvals/{approval_id}/approve", response_model=McpApprovalRead)
async def approve_mcp_approval(
    approval_id: str,
    session: SessionDep,
) -> McpApprovalRead:
    approval = approval_store.get(approval_id)
    if approval is None:
        raise HTTPException(status_code=404, detail="MCP approval not found.")
    if approval.status != "pending":
        return McpApprovalRead.model_validate(approval, from_attributes=True)
    approval_store.resolve(approval_id, "approved")
    record_event(
        session,
        event_type="mcp_approval_approved",
        status_value="completed",
        summary=f"MCP approval granted: {approval.server_name} / {approval.tool_name}",
        tool_name=approval.tool_name,
        input_value=approval.arguments,
    )
    return McpApprovalRead.model_validate(approval_store.get(approval.id), from_attributes=True)
