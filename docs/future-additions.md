# Future additions

These items are roadmap proposals, not currently enabled features. Local-first storage, explicit approval for external side effects, and narrow agent permissions remain mandatory.

## Autonomous Agents tab

Add a dedicated **Autonomous Agents** tab for creating and supervising recurring or long-running agent jobs. It should not turn the existing conversational Agent view into an unsupervised process manager.

Planned capabilities:

- Create jobs from reviewed templates with an explicit goal, schedule, input scope, and completion condition
- Show queued, running, waiting-for-approval, paused, completed, and failed states
- Expose the active harness, model, thinking level, elapsed time, token/cost budget, and latest checkpoint
- Pause, resume, cancel, retry, and immediately stop a job
- Require approval before external writes, messages, purchases, account changes, destructive actions, or newly discovered tool use
- Apply per-job time, token, cost, tool, and concurrency limits
- Persist checkpoints so interrupted work can resume safely
- Record lifecycle events and bounded tool activity in the Agent Ledger
- Use leases and heartbeats so crashed workers do not leave jobs falsely marked as active

Autonomous jobs must call approved FastAPI application tools. They must not read SQLite directly, silently expand their permissions, or continue indefinitely without a configured budget and stop condition.

## MCP servers

Add Model Context Protocol support as another tool adapter boundary. MCP does not replace ACP: ACP connects the dashboard to agent harnesses, while MCP can connect an approved harness or agent sidecar to narrowly scoped external tools and context providers.

Planned controls:

- Keep every MCP server disabled until the user explicitly configures and enables it
- Support local stdio servers first; require authentication and transport security for remote servers
- Discover tools, prompts, and resources, but require the user to approve an allowlist before agents can access them
- Classify each tool as read-only, local write, external side effect, destructive, or sensitive
- Route external side effects through the Approval Center
- Store credentials in local secret storage, never in SQLite conversation rows, prompts, logs, or backup archives by default
- Apply per-server timeouts, output-size bounds, rate limits, and process/resource limits
- Prevent MCP servers from opening `life.db`; dashboard data must continue to flow through FastAPI-owned tools
- Record server identity, tool name, bounded inputs/outputs, approval decisions, duration, and failures in the ledger
- Provide a global kill switch and per-server health/status controls

Remote MCP support needs additional protection against untrusted content, prompt injection, credential leakage, server identity changes, and network requests to private or unexpected destinations.

## Benchmarks

Create a repeatable benchmark suite before introducing a long-running sidecar, autonomous jobs, additional harnesses, or MCP servers. Benchmarks should use synthetic fixtures and test credentials rather than personal conversations.

Measure at least:

- API response latency for health, inbox, tasks, conversations, messages, runs, and ledger queries
- Agent process startup time, session creation/load time, time to first SSE text chunk, and total completion time
- Warm sidecar versus per-prompt process performance
- Concurrent runs across different conversations and rejection of duplicate same-conversation runs
- SQLite read/write latency, lock contention, migration time, backup duration, and restore verification
- Tool-call success, timeout, interruption, malformed output, approval, denial, and cancellation behavior
- Memory, CPU, child-process count, leaked processes, and recovery after crashes
- Frontend bundle size, hydration time, Core Web Vitals, long tasks, and reduced-motion behavior
- Harness/model combinations using fixed prompts, with output quality scored separately from runtime performance

Benchmark reports should include the git revision, machine profile, dataset size, harness/adapter/model versions, configuration, run count, median, p95, error rate, and raw result location. Establish baseline budgets in CI where measurements are stable, and run machine-dependent performance suites manually or on a dedicated benchmark runner.

## Suggested delivery order

1. Add benchmark fixtures and capture a baseline.
2. Implement the isolated agent sidecar and compare it with the current per-prompt lifecycle.
3. Add job persistence, budgets, checkpoints, and supervision APIs.
4. Ship the read-only Autonomous Agents tab before enabling job creation.
5. Add local stdio MCP servers with explicit per-tool allowlists.
6. Connect external MCP side effects to approvals.
7. Add remote MCP servers only after authentication, network policy, and secret-isolation reviews.
