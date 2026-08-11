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
  Command,
  Database,
  House,
  List,
  LockKey,
  MagnifyingGlass,
  Moon,
  PaperPlaneTilt,
  Plus,
  ShieldCheck,
  Sparkle,
  Sun,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { api } from "@/lib/api";
import type { AgentConfigOption, AgentConversation, AgentEvent, InboxItem, Task } from "@/lib/api";

type Area = "Today" | "Inbox" | "People" | "Agent" | "Approvals";
type CaptureTarget = "inbox" | "task";
type AgentMessage = { id: number; role: "user" | "assistant"; content: string };

const navigation = [
  { label: "Today" as Area, icon: House, count: null },
  { label: "Inbox" as Area, icon: Archive, count: null },
  { label: "People" as Area, icon: UsersThree, count: null },
  { label: "Agent" as Area, icon: Sparkle, count: null },
  { label: "Approvals" as Area, icon: ShieldCheck, count: 2 },
];

const schedule = [
  { time: "09:30", title: "Weekly planning", meta: "Personal · 45 min", tone: "sage" },
  { time: "11:00", title: "Product sync", meta: "Studio · 30 min", tone: "blue" },
  { time: "14:30", title: "Deep work", meta: "Protected · 2 hr", tone: "sand" },
];

const areaCopy: Record<Exclude<Area, "Today">, { title: string; body: string; action: string }> = {
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
  Approvals: {
    title: "You stay in control.",
    body: "Review every external action before anything leaves this dashboard.",
    action: "Review pending",
  },
};

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [approvals, setApprovals] = useState(["Send follow-up to Maya", "Create calendar hold"]);

  useEffect(() => {
    let active = true;
    Promise.all([api.listTasks(), api.listInbox()])
      .then(([taskData, inboxData]) => {
        if (!active) return;
        setTasks(taskData);
        setInboxItems(inboxData);
        setApiError(null);
      })
      .catch(() => {
        if (active) setApiError("The local API is offline. Start FastAPI on port 8000 and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
            const itemCount = item.label === "Approvals" ? approvals.length : item.label === "Inbox" ? inboxItems.length : item.count;
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
            <span className={apiError ? "sync-state offline" : "sync-state"}><span /> {loading ? "Connecting" : apiError ? "API offline" : "Synced locally"}</span>
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
        ) : area === "Agent" ? (
          <div className="content agent-view reveal">
            <section className="agent-page-header">
              <div>
                <p className="date"><Sparkle size={15} weight="fill" /> Pi agent · ACP</p>
                <h1>Ask, then stay<br />in control.</h1>
                <p className="day-summary">The first agent can talk with you and add requested items to your inbox.</p>
              </div>
              <div className="agent-controls">
                {agentConfigLoading ? <span className="agent-config-loading">Loading Pi models</span> : agentConfig?.map((config) => (
                  <label className="agent-select" key={config.id}>
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
                <span className="agent-scope"><LockKey size={13} weight="fill" /> Inbox access only</span>
              </div>
            </section>
            <div className="agent-session-bar">
              <label>
                <span className="sr-only">Active conversation</span>
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
              <button type="button" onClick={() => void createAgentConversation()} disabled={agentRunning}>
                <Plus size={14} weight="bold" /> New conversation
              </button>
              <span><Database size={13} weight="fill" /> Context saved locally</span>
            </div>
            <section className="agent-console">
              <div className="agent-messages" aria-live="polite">
                {agentMessages.length ? agentMessages.map((message) => (
                  <div className={`agent-message ${message.role}`} key={message.id}>
                    <span>{message.role === "assistant" ? <Brain size={15} weight="fill" /> : "You"}</span>
                    <p>{message.content || (agentRunning ? "Thinking" : "")}</p>
                  </div>
                )) : (
                  <div className="agent-welcome">
                    <div><Brain size={24} weight="duotone" /></div>
                    <h2>What should I remember?</h2>
                    <p>I can add a thought or reminder to your local inbox. Other tools are disabled.</p>
                    <div className="agent-suggestions">
                      <button type="button" onClick={() => setAgentInput("Add buy groceries to my inbox")}>Capture a reminder</button>
                      <button type="button" onClick={() => setAgentInput("What can you help me with?")}>Show capabilities</button>
                    </div>
                  </div>
                )}
              </div>
              {agentActivity ? <div className="agent-activity"><span /> {agentActivity}</div> : null}
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
                  placeholder="Ask Pi to remember something"
                  rows={2}
                  disabled={agentRunning}
                />
                <button type="submit" disabled={agentRunning || !agentInput.trim()} aria-label="Send message"><ArrowRight size={18} weight="bold" /></button>
              </form>
            </section>
            <footer className="privacy-note"><ShieldCheck size={14} weight="fill" /> Pi runs through ACP with only the inbox_create tool enabled.</footer>
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
