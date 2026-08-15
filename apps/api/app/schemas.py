from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TaskCreate(ApiModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = None
    context: str | None = Field(default=None, max_length=100)
    status: str = Field(default="backlog", pattern="^(backlog|in_progress|blocked|done)$")
    due_at: datetime | None = None


class TaskUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = None
    context: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, pattern="^(backlog|in_progress|blocked|done)$")
    due_at: datetime | None = None
    completed: bool | None = None


class TaskRead(ApiModel):
    id: int
    title: str
    notes: str | None
    context: str | None
    status: str
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


class AgentLedgerEntryRead(ApiModel):
    id: int
    conversation_id: int | None
    conversation_title: str
    run_id: str
    acp_session_id: str | None
    event_type: str
    status: str
    summary: str
    model: str | None
    thinking_level: str | None
    tool_call_id: str | None
    tool_name: str | None
    input_json: str | None
    output_json: str | None
    error: str | None
    created_at: datetime


class AgentRunRead(ApiModel):
    id: str
    conversation_id: int
    conversation_title: str
    model: str | None
    status: str
    started_at: datetime
    elapsed_seconds: int


class AgentStatusRead(ApiModel):
    available: bool
    adapter: str
    detail: str


class McpToolRead(ApiModel):
    name: str
    title: str | None = None
    description: str | None = None
    input_schema: dict[str, object] = Field(default_factory=dict)
    read_only: bool = False
    destructive: bool = False


class McpServerRead(ApiModel):
    id: str
    name: str
    command: str
    args: list[str]
    cwd: str | None
    enabled: bool
    built_in: bool
    allowed_tools: list[str]
    discovered_tools: list[dict[str, object]]
    last_tested_at: datetime | None
    last_error: str | None


class McpServerCreate(ApiModel):
    name: str = Field(min_length=1, max_length=100)
    command: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=30)
    cwd: str | None = Field(default=None, max_length=500)
    confirmed_risk: bool = False


class McpServerUpdate(ApiModel):
    enabled: bool | None = None
    allowed_tools: list[str] | None = Field(default=None, max_length=100)


class McpServerTestRead(ApiModel):
    server: McpServerRead
    tools: list[McpToolRead]
    truncated: bool


class McpToolCall(ApiModel):
    arguments: dict[str, object] = Field(default_factory=dict)


class McpToolCallRead(ApiModel):
    is_error: bool
    content: list[dict[str, object]]
    structured_content: dict[str, object] | None
    approval_required: bool = False
    approval_id: str | None = None


class McpApprovalRead(ApiModel):
    id: str
    server_id: str
    server_name: str
    tool_name: str
    arguments: dict[str, object]
    created_at: datetime
    status: str
    result: dict[str, object] | None = None
    error: str | None = None


class HealthRead(ApiModel):
    status: str
    database: str
