const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

export type HealthStatus = {
  status: string;
  database: string;
};

export type TaskStatus = "backlog" | "in_progress" | "blocked" | "done";

export type Task = {
  id: number;
  title: string;
  notes: string | null;
  context: string | null;
  status: TaskStatus;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboxItem = {
  id: number;
  content: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentConfigChoice = {
  value: string;
  name: string;
  description: string | null;
};

export type AgentConfigOption = {
  id: string;
  name: string;
  category: string | null;
  current_value: string;
  options: AgentConfigChoice[];
};

export type AgentConfiguration = { options: AgentConfigOption[] };

export type AgentConversation = {
  id: number;
  title: string;
  acp_session_id: string | null;
  model: string | null;
  thinking_level: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentLedgerEntry = {
  id: number;
  conversation_id: number | null;
  conversation_title: string;
  run_id: string;
  acp_session_id: string | null;
  event_type: string;
  status: string;
  summary: string;
  model: string | null;
  thinking_level: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  created_at: string;
};

export type AgentRun = {
  id: string;
  conversation_id: number;
  conversation_title: string;
  model: string | null;
  status: string;
  started_at: string;
  elapsed_seconds: number;
};

export type McpTool = {
  name: string;
  title: string | null;
  description: string | null;
  input_schema: Record<string, unknown>;
  read_only: boolean;
  destructive: boolean;
};

export type McpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string | null;
  enabled: boolean;
  built_in: boolean;
  allowed_tools: string[];
  discovered_tools: Array<Record<string, unknown>>;
  last_tested_at: string | null;
  last_error: string | null;
};

export type McpServerTest = {
  server: McpServer;
  tools: McpTool[];
  truncated: boolean;
};

export type McpApproval = {
  id: string;
  server_id: string;
  server_name: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  created_at: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type AgentMessageRecord = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AgentEvent =
  | { type: "session"; session_id: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; tool_call_id: string; title: string }
  | { type: "tool_update"; tool_call_id: string; status: string; title: string | null }
  | { type: "permission_denied"; title: string }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string };

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload && typeof payload.detail === "string" ? payload.detail : "The local API could not complete the request.";
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function streamAgentPrompt(
  conversationId: number,
  prompt: string,
  onEvent: (event: AgentEvent) => void,
  configuration?: { model?: string; thinking_level?: string },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/agent/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, prompt, ...configuration }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error("The agent stream could not be started.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const data = block.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
      if (data) onEvent(JSON.parse(data) as AgentEvent);
    }
    if (done) break;
  }
}

export const api = {
  getHealth: async (): Promise<HealthStatus> => {
    const response = await fetch(`${API_ORIGIN}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error("The local API health check failed.");
    return response.json() as Promise<HealthStatus>;
  },
  listTasks: () => request<Task[]>("/tasks"),
  createTask: (title: string) => request<Task>("/tasks", { method: "POST", body: { title, context: "Focus" } }),
  setTaskCompleted: (id: number, completed: boolean) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: { completed } }),
  setTaskStatus: (id: number, status: TaskStatus) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: { status } }),
  updateTask: (id: number, payload: { notes?: string | null; due_at?: string | null }) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: payload }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  listInbox: () => request<InboxItem[]>("/inbox?processed=false"),
  createInboxItem: (content: string) => request<InboxItem>("/inbox", { method: "POST", body: { content } }),
  setInboxProcessed: (id: number, processed: boolean) => request<InboxItem>(`/inbox/${id}`, { method: "PATCH", body: { processed } }),
  getAgentConfiguration: () => request<AgentConfiguration>("/agent/configuration"),
  listAgentRuns: () => request<AgentRun[]>("/agent/runs"),
  listAgentLedger: () => request<AgentLedgerEntry[]>("/agent/ledger"),
  listAgentConversations: (includeArchived = false) => request<AgentConversation[]>(`/agent/conversations${includeArchived ? "?include_archived=true" : ""}`),
  restoreAgentConversation: (conversationId: number) => request<AgentConversation>(`/agent/conversations/${conversationId}/restore`, { method: "POST" }),
  createAgentConversation: () => request<AgentConversation>("/agent/conversations", { method: "POST", body: {} }),
  listAgentMessages: (conversationId: number) => request<AgentMessageRecord[]>(`/agent/conversations/${conversationId}/messages`),
  deleteAgentConversation: (conversationId: number) => request<void>(`/agent/conversations/${conversationId}`, { method: "DELETE" }),
  listMcpServers: () => request<McpServer[]>("/mcp/servers"),
  addMcpServer: (payload: { name: string; command: string; args: string[]; cwd?: string; confirmed_risk: boolean }) => request<McpServer>("/mcp/servers", { method: "POST", body: payload }),
  testMcpServer: (id: string) => request<McpServerTest>(`/mcp/servers/${id}/test`, { method: "POST" }),
  updateMcpServer: (id: string, payload: { enabled?: boolean; allowed_tools?: string[] }) => request<McpServer>(`/mcp/servers/${id}`, { method: "PATCH", body: payload }),
  callMcpTool: (serverId: string, toolName: string, argumentsValue: Record<string, unknown> = {}) => request<{ is_error: boolean; content: Array<Record<string, unknown>>; structured_content: Record<string, unknown> | null; approval_required?: boolean; approval_id?: string | null }>(`/mcp/servers/${serverId}/tools/${toolName}/call`, { method: "POST", body: { arguments: argumentsValue } }),
  listMcpApprovals: () => request<McpApproval[]>("/mcp/approvals"),
  approveMcp: (id: string) => request<McpApproval>(`/mcp/approvals/${id}/approve`, { method: "POST" }),
  rejectMcp: (id: string) => request<McpApproval>(`/mcp/approvals/${id}/reject`, { method: "POST" }),
  deleteMcpServer: (id: string) => request<void>(`/mcp/servers/${id}`, { method: "DELETE" }),
  streamAgentPrompt,
};
