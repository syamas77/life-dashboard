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

The first standalone server now exists at `apps/mcp-apple-reminders`. It uses the official MCP TypeScript SDK and exposes only read-only Apple Reminders list and query tools over local stdio. Real macOS permission, list discovery, reminder reads, MCP tool discovery, and MCP tool invocation have been verified. It is not yet exposed to the restricted Pi harness; that requires the policy gateway, bounded ledger recording, and approval architecture described below. Write, complete, move, and delete tools remain intentionally absent.

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

## People graph and relationship memory

Expand the People area into a user-controlled personal relationship graph. The graph should represent individuals, groups, relationships, important events, commitments, shared interests, and links to source material without turning unverified model guesses into facts.

Planned capabilities:

- Generate an explorable graph from explicitly saved people records and user-approved source links
- Open a person or relationship to see relevant notes, conversations, events, commitments, and recent changes
- Keep separate memory scopes for an individual, a relationship between people, a group, and the dashboard owner
- Let the user pin durable facts, mark temporary context, correct mistakes, merge duplicates, and forget selected memories
- Attach provenance, confidence, creation time, last confirmation time, and source references to every generated memory
- Require confirmation before storing inferred sensitive attributes, relationship labels, conflicts, health details, or financial details
- Prevent one person's private context from being included in another person's prompt unless an explicit relationship rule allows it
- Offer timeline and graph views without requiring a graph database initially; SQLite can store graph-ready nodes and edges first
- Show exactly which memories will be sent to an agent before sensitive workflows

Agent-generated summaries are derived views, not authoritative facts. Deleting a source should make dependent memories reviewable and optionally remove or regenerate them.

## Obsidian and external knowledge sources

Add a personal knowledge-source layer that can connect the dashboard to an Obsidian “second brain” and other user-approved sources while keeping the dashboard usable offline.

### Obsidian connector

Start with a local, read-only Obsidian vault connector:

- Allowlist specific vaults, folders, and file patterns rather than indexing the entire filesystem
- Parse Markdown, YAML frontmatter, tags, wikilinks, embeds, and backlinks
- Preserve file paths and heading-level citations so every retrieved memory can open its original note
- Watch for file changes and maintain a local incremental index
- Treat write-back, note creation, renaming, and deletion as separately enabled actions that require preview and approval
- Never modify `.obsidian` configuration or plugin files without an explicit dedicated permission

The first implementation should work directly with local Markdown files and should not require an Obsidian plugin. A plugin can remain an optional later enhancement for richer events or UI integration.

### Other external sources

Use a connector interface for optional sources such as selected local folders, calendars, contacts, email, cloud drives, bookmarks, read-later services, and supported note applications.

Every connector must provide:

- Explicit opt-in, least-privilege scopes, and per-source pause/disconnect/delete controls
- Read-only access by default and Approval Center routing for external writes
- Incremental sync state, last-success time, errors, rate limits, and a clear offline state
- Source provenance and deep links on indexed records and generated memories
- Local encryption for stored tokens and exclusion of credentials from prompts, logs, and backups by default
- A way to delete imported content and derived indexes without deleting the original source
- Content-size limits, MIME validation, and quarantine for unsupported or suspicious files
- Protection against prompt injection in imported notes, email, web pages, and MCP resources; source text is untrusted data, never agent instructions

Retrieval should select the minimum relevant context and disclose which sources were used. Connecting a source must not automatically expose all of its content to every conversation, autonomous job, harness, or MCP server.

## Voice interaction

Add voice as an optional input and output mode for conversations and supervised agent workflows. Voice must be explicit, visible, and private by default rather than an always-listening assistant.

Planned capabilities:

- Start with push-to-talk recording in the Agent view, with a persistent recording indicator and an immediate stop control
- Show a reviewable transcript before sending it to an agent when the user enables transcript confirmation
- Support interruption, cancel, retry, keyboard control, and accessible text equivalents for every voice action
- Prefer local speech-to-text and text-to-speech engines when they meet the device's quality and performance needs
- Make cloud transcription or speech generation a separate opt-in provider with clear disclosure of what audio or text leaves the device
- Discard raw audio after transcription by default; retain recordings only when the user explicitly enables it
- Store transcript provenance, timestamps, provider/model identity, and correction history
- Allow per-conversation voice selection, playback speed, automatic playback, and mute controls
- Keep microphone permission scoped to active recording and never start background listening on application launch
- Require a visible, separately enabled mode before voice can interact with an autonomous job

Voice benchmarks should measure transcription accuracy on representative synthetic samples, time to partial and final transcript, first-audio latency, interruption behavior, CPU and memory use, offline availability, and failure recovery. Test microphone-denied and network-offline states as first-class flows.

## Portable export, upload, and cloud backup

Add a user-controlled backup center for exporting, uploading, verifying, and restoring dashboard data. Local files remain the source of truth; backup destinations receive encrypted, versioned archives rather than access to the live database.

Planned capabilities:

- Create a transactionally consistent SQLite snapshot through SQLite's backup API
- Package the database, Pi JSONL sessions, ACP session map, attachments, and a versioned manifest with checksums
- Let the user download an encrypted archive or save it to a selected local folder, external drive, or network share
- Support Amazon S3 and configurable S3-compatible destinations such as Cloudflare R2, Backblaze B2, MinIO, or a NAS gateway
- Allow custom endpoint, region, bucket, and path settings without assuming Amazon-hosted storage
- Add optional provider adapters for supported cloud drives after the portable archive format is stable
- Encrypt archives before upload with a user-controlled key or recovery secret
- Store cloud credentials in operating-system secret storage, never in conversation data, agent prompts, ledger payloads, or archives
- Support manual backups first, then optional schedules, retention limits, version listing, and pruning
- Show upload progress, archive size, checksum verification, last successful backup, and actionable errors
- Provide a restore preview, compatibility check, dry run, and automatic pre-restore local snapshot
- Restore into a staging location, validate checksums and schema, then apply required migrations before activation
- Regularly test restore paths; a successful upload alone does not prove that a backup is usable

Users should be able to exclude attachments, agent sessions, connector indexes, or other data classes from an archive. External source content such as an Obsidian vault should not be copied automatically when the original source remains available; the manifest can preserve connector configuration and rebuildable index metadata instead.

Agents, MCP servers, and source connectors must not receive backup credentials or direct bucket access. A future narrowly scoped backup service owns upload and restore operations and records only bounded status metadata in the ledger.

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
2. Define the portable encrypted archive format and ship manual local export plus verified restore.
3. Add manual S3-compatible upload, then schedules and retention only after restore testing.
4. Add push-to-talk with local transcription evaluation before considering cloud voice providers or automatic playback.
5. Implement the isolated agent sidecar and compare it with the current per-prompt lifecycle.
6. Add job persistence, budgets, checkpoints, and supervision APIs.
7. Ship the read-only Autonomous Agents tab before enabling job creation.
8. Add graph-ready People records, provenance, and manual memory controls before generating relationship summaries.
9. Add the read-only, folder-allowlisted Obsidian connector and benchmark local indexing and retrieval.
10. Add other external sources one at a time through the permissioned connector interface.
11. Connect the implemented read-only Apple Reminders stdio server to the dashboard MCP policy gateway and ledger, then add other local servers through explicit per-tool allowlists.
12. Add MCP write tools only after external side effects can route through approvals.
13. Add remote MCP servers only after authentication, network policy, and secret-isolation reviews.
