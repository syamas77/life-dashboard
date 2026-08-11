const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";

export type Task = {
  id: number;
  title: string;
  notes: string | null;
  context: string | null;
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
  created_at: string;
  updated_at: string;
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
  listTasks: () => request<Task[]>("/tasks"),
  createTask: (title: string) => request<Task>("/tasks", { method: "POST", body: { title, context: "Focus" } }),
  setTaskCompleted: (id: number, completed: boolean) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: { completed } }),
  listInbox: () => request<InboxItem[]>("/inbox?processed=false"),
  createInboxItem: (content: string) => request<InboxItem>("/inbox", { method: "POST", body: { content } }),
  setInboxProcessed: (id: number, processed: boolean) => request<InboxItem>(`/inbox/${id}`, { method: "PATCH", body: { processed } }),
  getAgentConfiguration: () => request<AgentConfiguration>("/agent/configuration"),
  listAgentConversations: () => request<AgentConversation[]>("/agent/conversations"),
  createAgentConversation: () => request<AgentConversation>("/agent/conversations", { method: "POST", body: {} }),
  listAgentMessages: (conversationId: number) => request<AgentMessageRecord[]>(`/agent/conversations/${conversationId}/messages`),
  deleteAgentConversation: (conversationId: number) => request<void>(`/agent/conversations/${conversationId}`, { method: "DELETE" }),
  streamAgentPrompt,
};
