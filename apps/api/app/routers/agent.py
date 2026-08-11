import json
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent_client import get_pi_configuration, stream_pi_prompt
from app.config import get_settings
from app.database import SessionDep
from app.models import AgentConversation, AgentMessage, utc_now
from app.schemas import (
    AgentConfigurationRead,
    AgentConversationCreate,
    AgentConversationRead,
    AgentMessageRead,
    AgentPrompt,
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
def list_conversations(session: SessionDep) -> list[AgentConversation]:
    statement = select(AgentConversation).order_by(AgentConversation.updated_at.desc())
    return list(session.scalars(statement))


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
    session.delete(conversation)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/prompt")
def prompt_agent(payload: AgentPrompt, session: SessionDep) -> StreamingResponse:
    settings = get_settings()
    conversation = find_conversation(payload.conversation_id, session)
    has_messages = (
        session.scalar(
            select(AgentMessage.id).where(AgentMessage.conversation_id == conversation.id).limit(1)
        )
        is not None
    )
    if not has_messages and conversation.title == "New conversation":
        conversation.title = payload.prompt.strip()[:60]
    conversation.model = payload.model or conversation.model
    conversation.thinking_level = payload.thinking_level or conversation.thinking_level
    conversation.updated_at = utc_now()
    session.add(AgentMessage(conversation_id=conversation.id, role="user", content=payload.prompt))
    session.commit()

    async def event_stream() -> AsyncIterator[str]:
        assistant_text: list[str] = []
        try:
            async for event in stream_pi_prompt(
                settings,
                payload.prompt,
                model=payload.model,
                thinking_level=payload.thinking_level,
                session_id=conversation.acp_session_id,
            ):
                if event.get("type") == "session" and not conversation.acp_session_id:
                    conversation.acp_session_id = str(event["session_id"])
                    session.commit()
                elif event.get("type") == "text_delta":
                    assistant_text.append(str(event["delta"]))
                elif event.get("type") == "done" and assistant_text:
                    session.add(
                        AgentMessage(
                            conversation_id=conversation.id,
                            role="assistant",
                            content="".join(assistant_text),
                        )
                    )
                    session.commit()

                event_name = str(event.get("type", "message"))
                yield encode_sse(event_name, event)
        except TimeoutError:
            yield encode_sse("error", {"type": "error", "message": "The agent timed out."})
        except Exception as error:
            yield encode_sse("error", {"type": "error", "message": str(error)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def find_conversation(conversation_id: int, session: Session) -> AgentConversation:
    conversation = session.get(AgentConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Agent conversation not found")
    return conversation


def encode_sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
