"use client";

import {
  Archive,
  ArrowRight,
  Bell,
  Brain,
  CalendarBlank,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  Command,
  Database,
  House,
  List,
  LockKey,
  MagnifyingGlass,
  Moon,
  PaperPlaneTilt,
  Plus,
  PlugsConnected,
  Robot,
  ShieldCheck,
  Sparkle,
  Sun,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ShiningText } from "@/components/ui/shining-text";
import { api } from "@/lib/api";
import type { AgentConfigOption, AgentConversation, AgentEvent, AgentLedgerEntry, AgentRun, InboxItem, McpServer, McpTool, Task } from "@/lib/api";

type Area = "Today" | "Inbox" | "People" | "Agent" | "World" | "Ledger" | "MCP" | "Approvals";
type CaptureTarget = "inbox" | "task";
type AgentMessage = { id: number; role: "user" | "assistant"; content: string };

const navigation = [
  { label: "Today" as Area, icon: House, count: null },
  { label: "Inbox" as Area, icon: Archive, count: null },
  { label: "People" as Area, icon: UsersThree, count: null },
  { label: "Agent" as Area, icon: Sparkle, count: null },
  { label: "World" as Area, icon: Robot, count: null },
  { label: "Ledger" as Area, icon: ClipboardText, count: null },
  { label: "MCP" as Area, icon: PlugsConnected, count: null },
  { label: "Approvals" as Area, icon: ShieldCheck, count: 2 },
];

const schedule = [
  { time: "09:30", title: "Weekly planning", meta: "Personal · 45 min", tone: "sage" },
  { time: "11:00", title: "Product sync", meta: "Studio · 30 min", tone: "blue" },
  { time: "14:30", title: "Deep work", meta: "Protected · 2 hr", tone: "sand" },
];

const areaCopy: Record<Exclude<Area, "Today" | "World" | "Ledger">, { title: string; body: string; action: string }> = {
  Inbox: {
    title: "Nothing gets lost.",
    body: "Capture a thought now. Decide what it means when you have time.",
    action: "Add to inbox",
  },
  People: {
    title: "Stay close, deliberately.",
    body: "Remember the context, promises, and small details that matter.",
    action: "Add a person",
  },
  Agent: {
    title: "Delegate with context.",
    body: "Your agent can prepare work, but external actions always wait for you.",
    action: "Start a request",
  },
  MCP: {
    title: "Connect trusted tools.",
    body: "Add local MCP servers, inspect their tools, and allow only the read-only capabilities you trust.",
    action: "Add MCP server",
  },
  Approvals: {
    title: "You stay in control.",
    body: "Review every external action before anything leaves this dashboard.",
    action: "Review pending",
  },
};

const agentSpeech: Record<string, string> = {
  starting: "Opening the bridge",
  thinking: "Reading the conversation",
  "using tool": "Working with the inbox",
  responding: "Sending a reply",
};

function AgentWorld({ runs }: { runs: AgentRun[] }) {
  return (
    <section className={runs.length ? "agent-world active" : "agent-world"} aria-live="polite">
      <header className="world-status">
        <div>
          <span>Live local runtime</span>
          <strong>{runs.length ? `${runs.length} ${runs.length === 1 ? "agent is" : "agents are"} awake` : "The workshop is quiet"}</strong>
        </div>
        <div className="world-process-count">
          <strong>{runs.length * 2}</strong>
          <span>child processes</span>
        </div>
      </header>

      <div className="world-scene">
        <div className="world-sun" aria-hidden="true" />
        <div className="world-cloud cloud-one" aria-hidden="true" />
        <div className="world-cloud cloud-two" aria-hidden="true" />
        <div className="world-station api-station">
          <span>API</span>
          <strong>FastAPI gate</strong>
        </div>
        <div className="world-station pi-station">
          <span>PI</span>
          <strong>Pi workshop</strong>
        </div>
        <div className="world-path" aria-hidden="true" />

        {runs.length ? runs.map((run, index) => (
          <article
            className={`world-agent world-agent-${index % 6 + 1}`}
            style={{ animationDelay: `${index * -0.8}s` }}
            key={run.id}
          >
            <div className="world-agent-speech">
              <strong>{agentSpeech[run.status] ?? run.status}</strong>
              <span>{run.elapsed_seconds}s</span>
            </div>
            <div className="world-robot-body">
              <Robot size={31} weight="duotone" />
            </div>
            <div className="world-agent-name">
              <strong>{run.conversation_title}</strong>
              <span>{run.model?.split("/").at(-1) ?? "default model"}</span>
            </div>
          </article>
        )) : (
          <div className="world-idle-dock">
            <div><Robot size={42} weight="duotone" /></div>
            <strong>Agents are resting</strong>
            <span>Start a conversation and return here to watch it work.</span>
          </div>
        )}
      </div>

      <footer className="world-key">
        <span><i /> Each robot is one active conversation</span>
        <span>FastAPI starts one pi-acp and Pi pair for every robot</span>
      </footer>
    </section>
  );
}

function toolsForMcpServer(server: McpServer, testedTools: Record<string, McpTool[]>): McpTool[] {
  if (testedTools[server.id]) return testedTools[server.id];
  return server.discovered_tools.map((raw) => {
    const annotations = (raw.annotations ?? {}) as Record<string, unknown>;
    return {
      name: String(raw.name ?? ""),
      title: typeof raw.title === "string" ? raw.title : null,
      description: typeof raw.description === "string" ? raw.description : null,
      input_schema: (raw.inputSchema ?? {}) as Record<string, unknown>,
      read_only: annotations.readOnlyHint === true,
      destructive: annotations.destructiveHint === true,
    };
  }).filter((tool) => tool.name);
}

function prettyLedgerValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export default function Dashboard() {
  const [area, setArea] = useState<Area>("Today");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [capture, setCapture] = useState("");
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>("inbox");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentActivity, setAgentActivity] = useState<string | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfigOption[] | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = useState(false);
  const [agentSelections, setAgentSelections] = useState<Record<string, string>>({});
  const [agentConversations, setAgentConversations] = useState<AgentConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentLedger, setAgentLedger] = useState<AgentLedgerEntry[]>([]);
  const [agentLedgerLoading, setAgentLedgerLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpTestingId, setMcpTestingId] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [approvals, setApprovals] = useState(["Send follow-up to Maya", "Create calendar hold"]);
  const agentMessagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.listTasks(), api.listInbox()])
      .then(([taskData, inboxData]) => {
        if (!active) return;
        setTasks(taskData);
        setInboxItems(inboxData);
        setApiOnline(true);
        setApiError(null);
      })
      .catch(() => {
        if (active) {
          setApiOnline(false);
          setApiError("The local API could not load dashboard data. Check FastAPI on port 8000.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refreshHealth = () => {
      api.getHealth()
        .then(() => {
          if (active) setApiOnline(true);
        })
        .catch(() => {
          if (active) setApiOnline(false);
        });
    };

    refreshHealth();
    const interval = window.setInterval(refreshHealth, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refreshRuns = () => {
      api.listAgentRuns()
        .then((runs) => {
          if (active) setAgentRuns(runs);
        })
        .catch(() => {
          if (active) setAgentRuns([]);
        });
    };

    refreshRuns();
    const interval = window.setInterval(refreshRuns, 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (area !== "Ledger") return;
    let active = true;

    const refreshLedger = () => {
      setAgentLedgerLoading(true);
      api.listAgentLedger()
        .then((entries) => {
          if (active) setAgentLedger(entries);
        })
        .catch(() => {
          if (active) setAgentLedger([]);
        })
        .finally(() => {
          if (active) setAgentLedgerLoading(false);
        });
    };

    refreshLedger();
    const interval = window.setInterval(refreshLedger, 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [area]);

  useEffect(() => {
    if (area !== "MCP") return;
    let active = true;
    api.listMcpServers()
      .then((servers) => {
        if (active) setMcpServers(servers);
      })
      .catch((error) => {
        if (active) setApiError(error instanceof Error ? error.message : "MCP servers could not be loaded.");
      })
      .finally(() => {
        if (active) setMcpLoading(false);
      });
    return () => { active = false; };
  }, [area]);

  useEffect(() => {
    if (area !== "Agent") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    agentMessagesEndRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [area, agentMessages, agentActivity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const date = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  async function openAgentConversation(conversation: AgentConversation) {
    if (agentRunning) return;
    setActiveConversationId(conversation.id);
    setAgentActivity("Loading conversation");
    try {
      const messages = await api.listAgentMessages(conversation.id);
      setAgentMessages(messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })));
      setAgentSelections((current) => ({
        ...current,
        ...(conversation.model ? { model: conversation.model } : {}),
        ...(conversation.thinking_level ? { thought_level: conversation.thinking_level } : {}),
      }));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The conversation could not be loaded.");
    } finally {
      setAgentActivity(null);
    }
  }

  function loadAgentWorkspace() {
    if (agentConfig || agentConfigLoading) return;
    setAgentConfigLoading(true);
    Promise.all([api.getAgentConfiguration(), api.listAgentConversations()])
      .then(async ([configuration, conversations]) => {
        setAgentConfig(configuration.options);
        setAgentSelections(Object.fromEntries(configuration.options.map((option) => [option.id, option.current_value])));
        setAgentConversations(conversations);
        if (conversations[0]) await openAgentConversation(conversations[0]);
      })
      .catch((error) => {
        setAgentConfig([]);
        setApiError(error instanceof Error ? error.message : "Pi configuration could not be loaded.");
      })
      .finally(() => setAgentConfigLoading(false));
  }

  async function createAgentConversation() {
    if (agentRunning) return;
    try {
      const conversation = await api.createAgentConversation();
      setAgentConversations((conversations) => [conversation, ...conversations]);
      setActiveConversationId(conversation.id);
      setAgentMessages([]);
      setAgentInput("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "A new conversation could not be created.");
    }
  }

  async function testMcpServer(serverId: string) {
    setMcpTestingId(serverId);
    setApiError(null);
    try {
      const result = await api.testMcpServer(serverId);
      setMcpServers((servers) => servers.map((server) => server.id === serverId ? result.server : server));
      setMcpTools((tools) => ({ ...tools, [serverId]: result.tools }));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP server test failed.");
      const servers = await api.listMcpServers().catch(() => []);
      if (servers.length) setMcpServers(servers);
    } finally {
      setMcpTestingId(null);
    }
  }

  async function setMcpServerEnabled(server: McpServer, enabled: boolean) {
    try {
      const updated = await api.updateMcpServer(server.id, { enabled });
      setMcpServers((servers) => servers.map((item) => item.id === server.id ? updated : item));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP server could not be updated.");
    }
  }

  async function setMcpToolAllowed(server: McpServer, toolName: string, allowed: boolean) {
    const allowedTools = allowed
      ? [...new Set([...server.allowed_tools, toolName])]
      : server.allowed_tools.filter((name) => name !== toolName);
    try {
      const updated = await api.updateMcpServer(server.id, { allowed_tools: allowedTools });
      setMcpServers((servers) => servers.map((item) => item.id === server.id ? updated : item));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP tool policy could not be updated.");
    }
  }

  async function removeMcpServer(server: McpServer) {
    if (server.built_in) return;
    try {
      await api.deleteMcpServer(server.id);
      setMcpServers((servers) => servers.filter((item) => item.id !== server.id));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP server could not be removed.");
    }
  }

  async function runMcpToolTest(server: McpServer, toolName: string) {
    setMcpTestingId(server.id);
    setMcpTestResult(null);
    setApiError(null);
    try {
      const result = await api.callMcpTool(server.id, toolName);
      setMcpTestResult(JSON.stringify(result.structured_content ?? result.content, null, 2));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP tool test failed.");
    } finally {
      setMcpTestingId(null);
    }
  }

  async function addMcpServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const args = String(form.get("args") ?? "").split("\n").map((value) => value.trim()).filter(Boolean);
    setMcpLoading(true);
    try {
      const server = await api.addMcpServer({
        name: String(form.get("name") ?? "").trim(),
        command: String(form.get("command") ?? "").trim(),
        args,
        cwd: String(form.get("cwd") ?? "").trim() || undefined,
        confirmed_risk: form.get("confirmed_risk") === "on",
      });
      setMcpServers((servers) => [...servers, server]);
      event.currentTarget.reset();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The MCP server could not be added.");
    } finally {
      setMcpLoading(false);
    }
  }

  function selectArea(nextArea: Area) {
    if (nextArea === "Agent") loadAgentWorkspace();
    setArea(nextArea);
    setSidebarOpen(false);
  }

  async function submitCapture(event: FormEvent) {
    event.preventDefault();
    const content = capture.trim();
    if (!content || saving) return;

    setSaving(true);
    setApiError(null);
    try {
      if (captureTarget === "task") {
        const task = await api.createTask(content);
        setTasks((items) => [task, ...items]);
      } else {
        const item = await api.createInboxItem(content);
        setInboxItems((items) => [item, ...items]);
      }
      setCapture("");
      setCaptureTarget("inbox");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The capture could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const completed = task.completed_at === null;
    setTasks((items) => items.map((item) => item.id === task.id ? { ...item, completed_at: completed ? new Date().toISOString() : null } : item));
    try {
      const updated = await api.setTaskCompleted(task.id, completed);
      setTasks((items) => items.map((item) => item.id === task.id ? updated : item));
    } catch (error) {
      setTasks((items) => items.map((item) => item.id === task.id ? task : item));
      setApiError(error instanceof Error ? error.message : "The task could not be updated.");
    }
  }

  async function processInboxItem(item: InboxItem) {
    setInboxItems((items) => items.filter((candidate) => candidate.id !== item.id));
    try {
      await api.setInboxProcessed(item.id, true);
    } catch (error) {
      setInboxItems((items) => [item, ...items]);
      setApiError(error instanceof Error ? error.message : "The inbox item could not be updated.");
    }
  }

  async function submitAgentPrompt(event: FormEvent) {
    event.preventDefault();
    const prompt = agentInput.trim();
    if (!prompt || agentRunning) return;

    setAgentRunning(true);
    setAgentActivity("Connecting to Pi");
    setApiError(null);

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const conversation = await api.createAgentConversation();
        conversationId = conversation.id;
        setActiveConversationId(conversation.id);
        setAgentConversations((conversations) => [conversation, ...conversations]);
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "A conversation could not be created.");
        setAgentRunning(false);
        setAgentActivity(null);
        return;
      }
    }

    const messageId = Date.now();
    const assistantId = messageId + 1;
    setAgentMessages((messages) => [
      ...messages,
      { id: messageId, role: "user", content: prompt },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setAgentInput("");

    const handleEvent = (agentEvent: AgentEvent) => {
      if (agentEvent.type === "text_delta") {
        setAgentMessages((messages) => messages.map((message) => message.id === assistantId ? { ...message, content: message.content + agentEvent.delta } : message));
      } else if (agentEvent.type === "tool_start") {
        setAgentActivity(`Using ${agentEvent.title}`);
      } else if (agentEvent.type === "tool_update" && agentEvent.status === "completed") {
        setAgentActivity("Inbox updated");
      } else if (agentEvent.type === "error") {
        setApiError(agentEvent.message);
        setAgentMessages((messages) => messages.map((message) => message.id === assistantId && !message.content ? { ...message, content: "I could not complete that request." } : message));
      }
    };

    try {
      await api.streamAgentPrompt(conversationId, prompt, handleEvent, {
        model: agentSelections.model,
        thinking_level: agentSelections.thought_level,
      });
      const [inbox, conversations] = await Promise.all([
        api.listInbox(),
        api.listAgentConversations(),
      ]);
      setInboxItems(inbox);
      setAgentConversations(conversations);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "The agent request failed.");
      setAgentMessages((messages) => messages.map((message) => message.id === assistantId && !message.content ? { ...message, content: "The local agent is unavailable." } : message));
    } finally {
      setAgentRunning(false);
      setAgentActivity(null);
    }
  }

  function focusCapture(target: CaptureTarget = "inbox") {
    setCaptureTarget(target);
    window.requestAnimationFrame(() => document.getElementById("capture")?.focus());
  }

  function resolveApproval(label: string) {
    setApprovals((items) => items.filter((item) => item !== label));
  }

  return (
    <div className={dark ? "app-shell dark" : "app-shell"}>
      <div className="ambient-backdrop" aria-hidden="true" />
      <button
        className="mobile-menu"
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
      >
        <List size={20} weight="bold" />
      </button>

      <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-head">
          <button className="brand" type="button" onClick={() => selectArea("Today")}>
            <BrandMark />
            <span>Life</span>
          </button>
          <button className="sidebar-close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
            <X size={18} weight="bold" />
          </button>
        </div>

        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const itemCount = item.label === "Approvals" ? approvals.length : item.label === "Inbox" ? inboxItems.length : item.label === "World" ? agentRuns.length : item.count;
            return (
              <button
                className={area === item.label ? "nav-item active" : "nav-item"}
                key={item.label}
                type="button"
                onClick={() => selectArea(item.label)}
              >
                <Icon size={18} weight={area === item.label ? "fill" : "regular"} />
                <span>{item.label}</span>
                {itemCount ? <span className="nav-count">{itemCount}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="local-card">
          <div className="local-icon"><Database size={17} weight="fill" /></div>
          <div>
            <strong>Local workspace</strong>
            <span>Stored on this device</span>
          </div>
          <CheckCircle size={17} weight="fill" />
        </div>
        <button className="profile" type="button">
          <span className="avatar">S</span>
          <span className="profile-copy"><strong>Personal</strong><small>Private space</small></span>
          <CaretDown size={14} weight="bold" />
        </button>
      </aside>

      {sidebarOpen ? <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}

      <main className="main">
        <header className="topbar">
          <button className="search-trigger" type="button" onClick={() => setPaletteOpen(true)}>
            <MagnifyingGlass size={17} weight="bold" />
            <span>Search or ask</span>
            <kbd><Command size={11} weight="bold" /> K</kbd>
          </button>
          <div className="top-actions">
            <span className={apiOnline === false ? "sync-state offline" : "sync-state"}><span /> {apiOnline === null || loading ? "Connecting" : apiOnline ? "Synced locally" : "API offline"}</span>
            <button className="icon-button" type="button" onClick={() => setDark((value) => !value)} aria-label="Toggle color theme">
              {dark ? <Sun size={18} weight="bold" /> : <Moon size={18} weight="bold" />}
            </button>
            <button className="icon-button notification" type="button" aria-label="Notifications">
              <Bell size={18} weight="bold" />
              <span />
            </button>
          </div>
        </header>

        {apiError ? (
          <div className="api-banner" role="alert">
            <span>{apiError}</span>
            <button type="button" onClick={() => setApiError(null)} aria-label="Dismiss error"><X size={14} weight="bold" /></button>
          </div>
        ) : null}

        {area === "Today" ? (
          <div className="content today-view">
            <section className="day-header reveal">
              <div>
                <p className="date"><CalendarBlank size={15} weight="bold" /> {date}</p>
                <h1>Good morning.</h1>
                <p className="day-summary">{tasks.filter((task) => !task.completed_at).length} open priorities and one protected focus block.</p>
              </div>
              <button className="primary-button" type="button" onClick={() => focusCapture("inbox")}>
                <Plus size={16} weight="bold" /> Capture
              </button>
            </section>

            <form className="capture reveal delay-1" onSubmit={submitCapture}>
              <div className="capture-icon">{captureTarget === "task" ? <CheckCircle size={18} weight="fill" /> : <Plus size={18} weight="bold" />}</div>
              <label htmlFor="capture" className="sr-only">{captureTarget === "task" ? "Add a priority" : "Capture an inbox item"}</label>
              <input
                id="capture"
                value={capture}
                onChange={(event) => setCapture(event.target.value)}
                placeholder={captureTarget === "task" ? "Add a priority" : "Capture a thought or reminder"}
                disabled={saving}
              />
              <span className="capture-hint">{saving ? "Saving" : captureTarget === "task" ? "To focus" : "To inbox"}</span>
              <button type="submit" aria-label="Save capture" disabled={saving}><ArrowRight size={18} weight="bold" /></button>
            </form>

            <div className="dashboard-grid">
              <section className="panel schedule-panel reveal delay-2">
                <div className="panel-heading">
                  <div><h2>Today&apos;s rhythm</h2><p>4 hours 15 minutes scheduled</p></div>
                  <button type="button">Open calendar <ArrowRight size={14} weight="bold" /></button>
                </div>
                <div className="timeline">
                  <div className="time-now"><span>Now</span><i /></div>
                  {schedule.map((event) => (
                    <div className="schedule-row" key={event.time}>
                      <time>{event.time}</time>
                      <div className={`event-marker ${event.tone}`} />
                      <div className="event-copy"><strong>{event.title}</strong><span>{event.meta}</span></div>
                      <button type="button" aria-label={`Open ${event.title}`}><ArrowRight size={15} weight="bold" /></button>
                    </div>
                  ))}
                  <div className="schedule-row free-row">
                    <time>17:00</time><div className="event-marker" />
                    <div className="event-copy"><strong>Day opens up</strong><span>No plans after this</span></div>
                  </div>
                </div>
              </section>

              <section className="panel focus-panel reveal delay-3">
                <div className="panel-heading">
                  <div><h2>Focus</h2><p>Your current priorities</p></div>
                  <span className="progress-label">{tasks.filter((task) => task.completed_at).length}/{tasks.length}</span>
                </div>
                <div className="task-list">
                  {loading ? <div className="list-state">Loading priorities</div> : tasks.length ? tasks.map((task) => (
                    <button
                      className={task.completed_at ? "task done" : "task"}
                      key={task.id}
                      type="button"
                      onClick={() => toggleTask(task)}
                    >
                      <span className="checkbox">{task.completed_at ? <Check size={13} weight="bold" /> : null}</span>
                      <span className="task-copy"><strong>{task.title}</strong><small>{task.context ?? "Focus"}</small></span>
                    </button>
                  )) : <div className="list-state">No priorities yet. Add one below.</div>}
                </div>
                <button className="text-button" type="button" onClick={() => focusCapture("task")}>
                  <Plus size={15} weight="bold" /> Add a priority
                </button>
              </section>

              <section className="agent-card reveal delay-3">
                <div className="agent-top">
                  <div className="agent-icon"><Brain size={22} weight="fill" /></div>
                  <span className="agent-status"><i /> Ready</span>
                </div>
                <div>
                  <p>Agent brief</p>
                  <h2>I can prepare your weekly review from notes and completed tasks.</h2>
                </div>
                <button type="button" onClick={() => selectArea("Agent")}>Review suggestion <ArrowRight size={15} weight="bold" /></button>
              </section>

              <section className="panel approvals-panel reveal delay-4">
                <div className="panel-heading">
                  <div><h2>Needs your approval</h2><p>Nothing happens without you</p></div>
                  <ShieldCheck size={20} weight="fill" />
                </div>
                {approvals.length ? (
                  <div className="approval-list">
                    {approvals.map((approval, index) => (
                      <div className="approval" key={approval}>
                        <span className="approval-type">{index === 0 ? <PaperPlaneTilt size={16} weight="fill" /> : <CalendarBlank size={16} weight="fill" />}</span>
                        <div><strong>{approval}</strong><small>{index === 0 ? "Draft ready · No data shared yet" : "Tomorrow · 09:00–10:00"}</small></div>
                        <button type="button" onClick={() => resolveApproval(approval)}>Review</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-approval"><CheckCircle size={20} weight="fill" /> All clear. No actions are waiting.</div>
                )}
              </section>
            </div>

            <footer className="privacy-note">
              <LockKey size={14} weight="fill" /> Your data stays local. Agents receive only the context you approve.
            </footer>
          </div>
        ) : area === "Inbox" ? (
          <div className="content inbox-view reveal">
            <section className="day-header">
              <div>
                <p className="date"><Archive size={15} weight="fill" /> Inbox · {inboxItems.length} open</p>
                <h1>Capture now.<br />Decide later.</h1>
                <p className="day-summary">Thoughts, reminders, and requests wait here until you process them.</p>
              </div>
            </section>
            <form className="capture" onSubmit={submitCapture}>
              <div className="capture-icon"><Plus size={18} weight="bold" /></div>
              <label htmlFor="capture" className="sr-only">Capture an inbox item</label>
              <input
                id="capture"
                value={capture}
                onFocus={() => setCaptureTarget("inbox")}
                onChange={(event) => setCapture(event.target.value)}
                placeholder="What is on your mind?"
                disabled={saving}
              />
              <span className="capture-hint">{saving ? "Saving" : "To inbox"}</span>
              <button type="submit" aria-label="Save to inbox" disabled={saving}><ArrowRight size={18} weight="bold" /></button>
            </form>
            <section className="panel inbox-panel">
              <div className="panel-heading">
                <div><h2>Unprocessed</h2><p>Review these when you are ready</p></div>
                <span className="progress-label">{inboxItems.length}</span>
              </div>
              <div className="inbox-list">
                {loading ? <div className="list-state">Loading inbox</div> : inboxItems.length ? inboxItems.map((item) => (
                  <div className="inbox-row" key={item.id}>
                    <span className="inbox-dot" />
                    <div><strong>{item.content}</strong><small>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.created_at))}</small></div>
                    <button type="button" onClick={() => processInboxItem(item)}><Check size={14} weight="bold" /> Processed</button>
                  </div>
                )) : <div className="inbox-empty"><CheckCircle size={24} weight="duotone" /><strong>Your inbox is clear.</strong><span>New captures and agent-added items will appear here.</span></div>}
              </div>
            </section>
          </div>
        ) : area === "World" ? (
          <div className="content world-view reveal">
            <section className="world-page-header">
              <div>
                <p className="date"><Robot size={15} weight="duotone" /> Agent world</p>
                <h1>See the work<br />while it happens.</h1>
                <p className="day-summary">Every active conversation appears as a live agent in your local workshop.</p>
              </div>
              <button className="primary-button" type="button" onClick={() => selectArea("Agent")}>
                Open Agent <ArrowRight size={15} weight="bold" />
              </button>
            </section>
            <AgentWorld runs={agentRuns} />
            <footer className="privacy-note"><LockKey size={14} weight="fill" /> This local view shows conversation titles and runtime status, never full prompts or responses.</footer>
          </div>
        ) : area === "Ledger" ? (
          <div className="content ledger-view reveal">
            <section className="ledger-page-header">
              <div>
                <p className="date"><ClipboardText size={15} weight="fill" /> Local agent ledger</p>
                <h1>Every action<br />leaves a trail.</h1>
                <p className="day-summary">Runs, model choices, tool calls, outcomes, and failures stay inspectable on this device.</p>
              </div>
              <div className="ledger-totals">
                <div><strong>{agentLedger.length}</strong><span>recent events</span></div>
                <div><strong>{agentLedger.filter((entry) => entry.event_type.startsWith("tool_")).length}</strong><span>tool events</span></div>
                <div><strong>{agentLedger.filter((entry) => entry.status === "failed").length}</strong><span>failed</span></div>
              </div>
            </section>

            <section className="ledger-panel">
              <header>
                <div><strong>Recent activity</strong><span>Newest first</span></div>
                <span>{agentLedgerLoading ? "Refreshing" : "Stored in SQLite"}</span>
              </header>
              <div className="ledger-list">
                {agentLedgerLoading && !agentLedger.length ? (
                  <div className="ledger-empty">Loading the local ledger</div>
                ) : agentLedger.length ? agentLedger.map((entry) => (
                  <article className={`ledger-entry ${entry.status}`} key={entry.id}>
                    <div className="ledger-entry-mark">
                      {entry.event_type.startsWith("tool_") ? <Robot size={16} weight="duotone" /> : entry.status === "completed" ? <CheckCircle size={16} weight="fill" /> : <ClipboardText size={16} weight="duotone" />}
                    </div>
                    <div className="ledger-entry-copy">
                      <div>
                        <strong>{entry.summary}</strong>
                        <time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(entry.created_at))}</time>
                      </div>
                      <p>{entry.conversation_title}</p>
                      <span>{entry.event_type.replaceAll("_", " ")} / {entry.model?.split("/").at(-1) ?? "default model"}{entry.thinking_level ? ` / ${entry.thinking_level}` : ""}</span>
                      {entry.input_json || entry.output_json || entry.error ? (
                        <details>
                          <summary>Inspect event data</summary>
                          {entry.input_json ? <div><strong>Input</strong><pre>{prettyLedgerValue(entry.input_json)}</pre></div> : null}
                          {entry.output_json ? <div><strong>Output</strong><pre>{prettyLedgerValue(entry.output_json)}</pre></div> : null}
                          {entry.error ? <div><strong>Error</strong><pre>{entry.error}</pre></div> : null}
                        </details>
                      ) : null}
                    </div>
                  </article>
                )) : (
                  <div className="ledger-empty"><ClipboardText size={26} weight="duotone" /><strong>No agent activity yet</strong><span>Completed runs and tool calls will appear here.</span></div>
                )}
              </div>
            </section>
            <footer className="privacy-note"><Database size={14} weight="fill" /> Ledger events stay in life.db indefinitely. Encrypted, opt-in cloud backups are planned.</footer>
          </div>
        ) : area === "MCP" ? (
          <div className="content mcp-view reveal">
            <header className="mcp-page-header">
              <div>
                <p className="date"><PlugsConnected size={15} weight="duotone" /> Local tool connections</p>
                <h1>MCP servers</h1>
                <p>Add trusted local servers, inspect what they expose, and allow tools one at a time.</p>
              </div>
              <span>{mcpServers.filter((server) => server.enabled).length} enabled</span>
            </header>

            <aside className="mcp-risk-note">
              <LockKey size={17} weight="fill" />
              <div><strong>Adding a server runs local code.</strong><span>Life never installs packages automatically. Use software you trust; commands run with your macOS user permissions and without a shell.</span></div>
            </aside>

            <section className="mcp-server-list">
              {mcpLoading && !mcpServers.length ? <div className="mcp-empty">Loading local MCP configuration</div> : mcpServers.map((server) => {
                const tools = toolsForMcpServer(server, mcpTools);
                return (
                  <article className="mcp-server-card" key={server.id}>
                    <header>
                      <div className="mcp-server-icon"><PlugsConnected size={20} weight="duotone" /></div>
                      <div><strong>{server.name}</strong><span>{server.built_in ? "Bundled with Life Dashboard" : "Custom local server"}</span></div>
                      <span className={`mcp-health ${server.last_error ? "failed" : server.last_tested_at ? "verified" : "untested"}`} title="Health reflects the most recent connection test; stdio servers are not kept running."><i />{server.last_error ? "Failed" : server.last_tested_at ? "Verified" : "Not tested"}</span>
                      <label className="mcp-toggle"><input type="checkbox" checked={server.enabled} onChange={(event) => void setMcpServerEnabled(server, event.target.checked)} /><span>{server.enabled ? "Enabled" : "Disabled"}</span></label>
                    </header>
                    <code>{[server.command, ...server.args].join(" ")}</code>
                    <div className="mcp-server-actions">
                      <button type="button" onClick={() => void testMcpServer(server.id)} disabled={mcpTestingId === server.id}>{mcpTestingId === server.id ? "Testing…" : "Test connection"}</button>
                      {!server.built_in ? <button type="button" onClick={() => void removeMcpServer(server)}>Remove</button> : null}
                      <span>{server.last_tested_at ? `Last tested ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(server.last_tested_at))}` : "Not tested yet"}</span>
                    </div>
                    {server.last_error ? <p className="mcp-server-error">{server.last_error}</p> : null}
                    {tools.length ? (
                      <div className="mcp-tool-list">
                        {tools.map((tool) => {
                          const safe = tool.read_only && !tool.destructive;
                          const allowed = server.allowed_tools.includes(tool.name);
                          return (
                            <div className="mcp-tool-row" key={tool.name}>
                              <div><strong>{tool.title ?? tool.name}</strong><span>{tool.description ?? tool.name}</span></div>
                              <span className={safe ? "mcp-readonly" : "mcp-unsafe"}>{safe ? "Read only" : "Blocked"}</span>
                              <label><input type="checkbox" checked={allowed} disabled={!safe} onChange={(event) => void setMcpToolAllowed(server, tool.name, event.target.checked)} /> Allow</label>
                              <button type="button" disabled={!server.enabled || !allowed || !safe || mcpTestingId === server.id} onClick={() => void runMcpToolTest(server, tool.name)}>Run</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="mcp-no-tools">Test the connection to inspect this server&apos;s tools.</p>}
                  </article>
                );
              })}
            </section>

            {mcpTestResult ? <section className="mcp-test-output"><header><strong>Latest read-only tool result</strong><button type="button" onClick={() => setMcpTestResult(null)}><X size={13} /></button></header><pre>{mcpTestResult}</pre></section> : null}

            <details className="mcp-add-server">
              <summary><Plus size={14} weight="bold" /> Add a local MCP server</summary>
              <form onSubmit={addMcpServer}>
                <label><span>Name</span><input name="name" required maxLength={100} placeholder="My trusted MCP server" /></label>
                <label><span>Absolute executable path</span><input name="command" required maxLength={500} placeholder="/opt/homebrew/bin/node" /></label>
                <label><span>Arguments, one per line</span><textarea name="args" rows={3} placeholder="/absolute/path/to/server.js" /></label>
                <label><span>Working directory (optional)</span><input name="cwd" maxLength={500} placeholder="/absolute/path/to/project" /></label>
                <label className="mcp-confirm"><input name="confirmed_risk" type="checkbox" required /><span>I trust this server and understand that adding it executes local code with my user permissions.</span></label>
                <button type="submit" disabled={mcpLoading}>Add disabled server</button>
              </form>
            </details>
            <footer className="privacy-note"><ShieldCheck size={14} weight="fill" /> Only enabled and explicitly allowed read-only tools can run. Tests and calls are recorded in the Ledger.</footer>
          </div>
        ) : area === "Agent" ? (
          <div className="content agent-view reveal">
            <header className="agent-chat-header">
              <div className="agent-chat-identity">
                <div><Sparkle size={18} weight="fill" /></div>
                <span><strong>Agent</strong><small>Pi connected through ACP</small></span>
              </div>
              <span className="agent-current-scope"><LockKey size={12} weight="fill" /> Inbox access only</span>
            </header>

            <section className="agent-console">
              <div className="agent-messages" aria-live="polite">
                {agentMessages.length ? agentMessages.map((message) => (
                  <div className={`agent-message ${message.role}${message.role === "assistant" && !message.content && agentRunning ? " pending" : ""}`} key={message.id}>
                    <span>{message.role === "assistant" ? <Sparkle size={15} weight="fill" /> : "You"}</span>
                    {message.content ? <p>{message.content}</p> : agentRunning ? <ShiningText text={agentActivity ?? "Pi is thinking..."} className="agent-thinking text-xs" /> : <p />}
                  </div>
                )) : (
                  <div className="agent-welcome">
                    <div><Sparkle size={25} weight="duotone" /></div>
                    <h1>What&apos;s on your mind today?</h1>
                    <p>Talk things through with Pi, or ask it to save something to your private local inbox.</p>
                    <div className="agent-suggestions">
                      <button type="button" onClick={() => setAgentInput("Add buy groceries to my inbox")}>Capture a reminder</button>
                      <button type="button" onClick={() => setAgentInput("Help me think through a decision")}>Think through a decision</button>
                      <button type="button" onClick={() => setAgentInput("What can you help me with?")}>Show capabilities</button>
                    </div>
                  </div>
                )}
                <div ref={agentMessagesEndRef} className="agent-messages-end" aria-hidden="true" />
              </div>
              <form className="agent-composer" onSubmit={submitAgentPrompt}>
                <label htmlFor="agent-prompt" className="sr-only">Message the Life Dashboard agent</label>
                <textarea
                  id="agent-prompt"
                  value={agentInput}
                  onChange={(event) => setAgentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Message your agent"
                  rows={2}
                  disabled={agentRunning}
                />
                <button type="submit" disabled={agentRunning || !agentInput.trim()} aria-label="Send message"><ArrowRight size={18} weight="bold" /></button>
              </form>
              <div className="agent-bottom-controls">
                <label className="agent-bottom-select conversation-select">
                  <span>Conversation</span>
                  <select
                    value={activeConversationId ?? ""}
                    onChange={(event) => {
                      const conversation = agentConversations.find((item) => item.id === Number(event.target.value));
                      if (conversation) void openAgentConversation(conversation);
                    }}
                    disabled={agentRunning || agentConfigLoading}
                  >
                    {!agentConversations.length ? <option value="">No saved conversations</option> : null}
                    {agentConversations.map((conversation) => <option value={conversation.id} key={conversation.id}>{conversation.title}</option>)}
                  </select>
                </label>
                {agentConfigLoading ? <span className="agent-config-loading">Loading Pi options</span> : agentConfig?.map((config) => (
                  <label className="agent-bottom-select" key={config.id}>
                    <span>{config.name}</span>
                    <select
                      value={agentSelections[config.id] ?? config.current_value}
                      onChange={(event) => setAgentSelections((current) => ({ ...current, [config.id]: event.target.value }))}
                      disabled={agentRunning}
                    >
                      {config.options.map((option) => <option value={option.value} key={option.value}>{option.name}</option>)}
                    </select>
                  </label>
                ))}
                <button type="button" onClick={() => void createAgentConversation()} disabled={agentRunning} aria-label="New conversation">
                  <Plus size={15} weight="bold" />
                </button>
              </div>
            </section>

            <p className="agent-future-note"><ShieldCheck size={13} weight="fill" /> Pi is connected today. The ACP boundary is ready for additional agent harnesses in the future.</p>
          </div>
        ) : (
          <div className="content area-view reveal">
            <p className="date">{area}</p>
            <h1>{areaCopy[area].title}</h1>
            <p>{areaCopy[area].body}</p>
            <button className="primary-button" type="button"><Plus size={16} weight="bold" /> {areaCopy[area].action}</button>
            <div className="area-preview">
              <div className="preview-symbol">
                {area === "People" && <UserCircle size={30} weight="duotone" />}
                {area === "Approvals" && <ShieldCheck size={30} weight="duotone" />}
              </div>
              <strong>The {area.toLowerCase()} workspace is ready for your data.</strong>
              <span>This first design pass focuses on the daily overview.</span>
            </div>
          </div>
        )}
      </main>

      {paletteOpen ? (
        <div className="palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
          <div className="palette" role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={(event) => event.stopPropagation()}>
            <div className="palette-search"><MagnifyingGlass size={18} weight="bold" /><input autoFocus placeholder="Search tasks, people, or ask your agent" /><kbd>ESC</kbd></div>
            <p>Go to</p>
            {navigation.map((item) => {
              const Icon = item.icon;
              return <button type="button" key={item.label} onClick={() => { selectArea(item.label); setPaletteOpen(false); }}><Icon size={18} weight="fill" /><span>{item.label}</span><ArrowRight size={14} weight="bold" /></button>;
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
