import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agent_client import delete_pi_session_artifacts, get_pi_configuration, stream_pi_prompt
from app.agent_runtime import AgentRun, AgentRunRegistry
from app.config import get_settings
from app.database import SessionDep
from app.models import AgentConversation, AgentLedgerEntry, AgentMessage, utc_now
from app.schemas import (
    AgentConfigurationRead,
    AgentConversationCreate,
    AgentConversationRead,
    AgentLedgerEntryRead,
    AgentMessageRead,
    AgentPrompt,
    AgentRunRead,
    AgentStatusRead,
)

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/status", response_model=AgentStatusRead)
def agent_status() -> AgentStatusRead:
    settings = get_settings()
    adapter_exists = Path(settings.agent_command).is_file()
    launcher_exists = Path(settings.agent_pi_command).is_file()
    available = adapter_exists and launcher_exists

    if not adapter_exists:
        detail = "pi-acp is not installed. Run npm install in apps/agent."
    elif not launcher_exists:
        detail = "The restricted Pi launcher is missing."
    else:
        detail = "The pinned pi-acp adapter and restricted Pi launcher are ready."

    return AgentStatusRead(available=available, adapter="pi-acp@0.0.33", detail=detail)


@router.get("/runs", response_model=list[AgentRunRead])
def active_agent_runs(request: Request) -> list[AgentRun]:
    registry: AgentRunRegistry = request.app.state.agent_runs
    return registry.list()


@router.get("/ledger", response_model=list[AgentLedgerEntryRead])
def list_agent_ledger(
    session: SessionDep,
    conversation_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[AgentLedgerEntry]:
    statement = (
        select(AgentLedgerEntry)
        .options(joinedload(AgentLedgerEntry.conversation))
        .order_by(AgentLedgerEntry.created_at.desc())
        .limit(limit)
    )
    if conversation_id is not None:
        statement = statement.where(AgentLedgerEntry.conversation_id == conversation_id)
    return list(session.scalars(statement))


@router.get("/configuration", response_model=AgentConfigurationRead)
async def agent_configuration() -> AgentConfigurationRead:
    settings = get_settings()
    try:
        configuration = await get_pi_configuration(settings)
    except TimeoutError as error:
        raise HTTPException(
            status_code=504, detail="Loading Pi configuration timed out."
        ) from error
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return AgentConfigurationRead.model_validate(configuration)


@router.get("/conversations", response_model=list[AgentConversationRead])
def list_conversations(
    session: SessionDep,
    include_archived: bool = Query(False),
) -> list[AgentConversation]:
    cleanup_old_conversations(session)
    statement = select(AgentConversation).order_by(AgentConversation.updated_at.desc())
    if not include_archived:
        statement = statement.where(AgentConversation.archived_at.is_(None))
    return list(session.scalars(statement))


@router.post("/conversations/{conversation_id}/restore", response_model=AgentConversationRead)
def restore_conversation(conversation_id: int, session: SessionDep) -> AgentConversation:
    conversation = find_conversation(conversation_id, session)
    conversation.archived_at = None
    session.commit()
    session.refresh(conversation)
    return conversation


@router.post(
    "/conversations",
    response_model=AgentConversationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_conversation(
    payload: AgentConversationCreate,
    session: SessionDep,
) -> AgentConversation:
    conversation = AgentConversation(title=payload.title)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[AgentMessageRead],
)
def list_conversation_messages(
    conversation_id: int,
    session: SessionDep,
) -> list[AgentMessage]:
    find_conversation(conversation_id, session)
    statement = (
        select(AgentMessage)
        .where(AgentMessage.conversation_id == conversation_id)
        .order_by(AgentMessage.created_at)
    )
    return list(session.scalars(statement))


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_conversation(conversation_id: int, session: SessionDep) -> Response:
    conversation = find_conversation(conversation_id, session)
    delete_pi_session_artifacts(conversation.acp_session_id)
    session.delete(conversation)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/prompt")
def prompt_agent(
    payload: AgentPrompt,
    request: Request,
    session: SessionDep,
) -> StreamingResponse:
    settings = get_settings()
    registry: AgentRunRegistry = request.app.state.agent_runs
    conversation = find_conversation(payload.conversation_id, session)
    has_messages = (
        session.scalar(
            select(AgentMessage.id).where(AgentMessage.conversation_id == conversation.id).limit(1)
        )
        is not None
    )
    if not has_messages and conversation.title == "New conversation":
        conversation.title = payload.prompt.strip()[:60]
    try:
        run = registry.start(
            conversation_id=conversation.id,
            conversation_title=conversation.title,
            model=payload.model or conversation.model,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    try:
        conversation.model = payload.model or conversation.model
        conversation.thinking_level = payload.thinking_level or conversation.thinking_level
        conversation.updated_at = utc_now()
        session.add(
            AgentMessage(conversation_id=conversation.id, role="user", content=payload.prompt)
        )
        session.add(
            make_ledger_entry(
                conversation=conversation,
                run_id=run.id,
                event_type="run_started",
                status="in_progress",
                summary="Agent run started",
            )
        )
        session.commit()
    except Exception:
        registry.finish(run.id)
        raise

    async def event_stream() -> AsyncIterator[str]:
        assistant_text: list[str] = []
        tool_names: dict[str, str] = {}
        terminal_recorded = False
        try:
            async for event in stream_pi_prompt(
                settings,
                payload.prompt,
                model=payload.model,
                thinking_level=payload.thinking_level,
                session_id=conversation.acp_session_id,
            ):
                if event.get("type") == "session":
                    registry.update(run.id, "thinking")
                    is_new_session = not conversation.acp_session_id
                    if is_new_session:
                        conversation.acp_session_id = str(event["session_id"])
                    session.add(
                        make_ledger_entry(
                            conversation=conversation,
                            run_id=run.id,
                            event_type="session_connected",
                            status="completed",
                            summary=(
                                "New Pi session connected"
                                if is_new_session
                                else "Saved Pi session resumed"
                            ),
                        )
                    )
                    session.commit()
                elif event.get("type") == "text_delta":
                    registry.update(run.id, "responding")
                    assistant_text.append(str(event["delta"]))
                elif event.get("type") == "tool_start":
                    registry.update(run.id, "using tool")
                    tool_call_id = str(event.get("tool_call_id") or "")
                    tool_name = str(event.get("title") or "Agent tool")
                    if tool_call_id:
                        tool_names[tool_call_id] = tool_name
                    session.add(
                        make_ledger_entry(
                            conversation=conversation,
                            run_id=run.id,
                            event_type="tool_started",
                            status="in_progress",
                            summary=f"{tool_name} started",
                            tool_call_id=tool_call_id or None,
                            tool_name=tool_name,
                            input_json=serialize_ledger_value(event.get("raw_input")),
                        )
                    )
                    session.commit()
                elif event.get("type") == "tool_update":
                    tool_status = str(event.get("status", ""))
                    next_status = (
                        "thinking" if tool_status in {"completed", "failed"} else "using tool"
                    )
                    registry.update(run.id, next_status)
                    if tool_status in {"completed", "failed"}:
                        tool_call_id = str(event.get("tool_call_id") or "")
                        tool_name = str(
                            event.get("title") or tool_names.get(tool_call_id) or "Agent tool"
                        )
                        session.add(
                            make_ledger_entry(
                                conversation=conversation,
                                run_id=run.id,
                                event_type=(
                                    "tool_completed"
                                    if tool_status == "completed"
                                    else "tool_failed"
                                ),
                                status=tool_status,
                                summary=f"{tool_name} {tool_status}",
                                tool_call_id=tool_call_id or None,
                                tool_name=tool_name,
                                input_json=serialize_ledger_value(event.get("raw_input")),
                                output_json=serialize_ledger_value(event.get("raw_output")),
                            )
                        )
                        session.commit()
                elif event.get("type") == "done":
                    if assistant_text:
                        session.add(
                            AgentMessage(
                                conversation_id=conversation.id,
                                role="assistant",
                                content="".join(assistant_text),
                            )
                        )
                    session.add(
                        make_ledger_entry(
                            conversation=conversation,
                            run_id=run.id,
                            event_type="run_completed",
                            status="completed",
                            summary="Agent response completed",
                        )
                    )
                    session.commit()
                    terminal_recorded = True

                event_name = str(event.get("type", "message"))
                yield encode_sse(event_name, event)
        except TimeoutError:
            record_terminal_event(
                session,
                conversation,
                run.id,
                event_type="run_timed_out",
                summary="Agent run timed out",
                error="The agent timed out.",
            )
            terminal_recorded = True
            yield encode_sse("error", {"type": "error", "message": "The agent timed out."})
        except Exception as error:
            record_terminal_event(
                session,
                conversation,
                run.id,
                event_type="run_failed",
                summary="Agent run failed",
                error=str(error),
            )
            terminal_recorded = True
            yield encode_sse("error", {"type": "error", "message": str(error)})
        finally:
            if not terminal_recorded:
                record_terminal_event(
                    session,
                    conversation,
                    run.id,
                    event_type="run_interrupted",
                    summary="Agent stream was interrupted",
                )
            registry.finish(run.id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def make_ledger_entry(
    *,
    conversation: AgentConversation,
    run_id: str,
    event_type: str,
    status: str,
    summary: str,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
    input_json: str | None = None,
    output_json: str | None = None,
    error: str | None = None,
) -> AgentLedgerEntry:
    return AgentLedgerEntry(
        conversation_id=conversation.id,
        run_id=run_id,
        acp_session_id=conversation.acp_session_id,
        event_type=event_type,
        status=status,
        summary=summary,
        model=conversation.model,
        thinking_level=conversation.thinking_level,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        input_json=input_json,
        output_json=output_json,
        error=error[:8000] if error else None,
    )


def serialize_ledger_value(value: object) -> str | None:
    if value is None:
        return None
    serialized = json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) <= 8000:
        return serialized
    return json.dumps(
        {"truncated": True, "preview": serialized[:7900]},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def record_terminal_event(
    session: Session,
    conversation: AgentConversation,
    run_id: str,
    *,
    event_type: str,
    summary: str,
    error: str | None = None,
) -> None:
    try:
        session.add(
            make_ledger_entry(
                conversation=conversation,
                run_id=run_id,
                event_type=event_type,
                status="failed",
                summary=summary,
                error=error,
            )
        )
        session.commit()
    except Exception:
        session.rollback()


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def cleanup_old_conversations(session: Session) -> None:
    now = utc_now()
    archive_before = now - timedelta(days=30)
    delete_before = now - timedelta(days=60)
    candidates = list(session.scalars(select(AgentConversation)))
    changed = False
    for conversation in candidates:
        if conversation.archived_at is not None and conversation.archived_at <= delete_before:
            delete_pi_session_artifacts(conversation.acp_session_id)
            session.delete(conversation)
            changed = True
        elif (
            conversation.archived_at is None
            and _as_utc(conversation.updated_at) <= archive_before
        ):
            conversation.archived_at = now
            changed = True
    if changed:
        session.commit()


def find_conversation(conversation_id: int, session: Session) -> AgentConversation:
    conversation = session.get(AgentConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Agent conversation not found")
    return conversation


def encode_sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
