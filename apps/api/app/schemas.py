from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TaskCreate(ApiModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = None
    context: str | None = Field(default=None, max_length=100)
    due_at: datetime | None = None


class TaskUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = None
    context: str | None = Field(default=None, max_length=100)
    due_at: datetime | None = None
    completed: bool | None = None


class TaskRead(ApiModel):
    id: int
    title: str
    notes: str | None
    context: str | None
    due_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class InboxItemCreate(ApiModel):
    content: str = Field(min_length=1, max_length=2000)


class InboxItemUpdate(ApiModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    processed: bool | None = None


class InboxItemRead(ApiModel):
    id: int
    content: str
    processed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentPrompt(ApiModel):
    conversation_id: int
    prompt: str = Field(min_length=1, max_length=4000)
    model: str | None = Field(default=None, max_length=300)
    thinking_level: str | None = Field(default=None, max_length=40)


class AgentConfigChoiceRead(ApiModel):
    value: str
    name: str
    description: str | None = None


class AgentConfigOptionRead(ApiModel):
    id: str
    name: str
    category: str | None
    current_value: str
    options: list[AgentConfigChoiceRead]


class AgentConfigurationRead(ApiModel):
    options: list[AgentConfigOptionRead]


class AgentConversationCreate(ApiModel):
    title: str = Field(default="New conversation", min_length=1, max_length=200)


class AgentConversationRead(ApiModel):
    id: int
    title: str
    acp_session_id: str | None
    model: str | None
    thinking_level: str | None
    created_at: datetime
    updated_at: datetime


class AgentMessageRead(ApiModel):
    id: int
    conversation_id: int
    role: str
    content: str
    created_at: datetime


class AgentStatusRead(ApiModel):
    available: bool
    adapter: str
    detail: str


class HealthRead(ApiModel):
    status: str
    database: str
