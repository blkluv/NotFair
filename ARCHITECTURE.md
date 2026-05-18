# Architecture

> Single-user local app. No auth, no multi-tenancy, no hosted backend.

## Process layout

```
USER'S MACHINE
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌────────────────────────────────────┐    ┌──────────────────────┐  │
│  │  notfair-cmo (Next.js)             │    │  OpenClaw daemon     │  │
│  │  npx notfair-cmo → localhost:3000  │◀──▶│  WebSocket gateway   │  │
│  │                                    │    │  on loopback         │  │
│  │  ┌──────────────────────────────┐  │    └──────────┬───────────┘  │
│  │  │ Frontend (React + shadcn)    │  │               │ subprocess   │
│  │  │  - Sidebar shell + nav       │  │               ▼              │
│  │  │  - CMO chat (SSE-streamed)   │  │    ┌──────────────────────┐  │
│  │  │  - Cron tab                  │  │    │  openclaw CLI        │  │
│  │  │  - Approval inbox (V0.1: stub)│  │    │  - agents add/list   │  │
│  │  │  - Cost meter (V0.1: zero)   │  │    │  - cron add/list/rm  │  │
│  │  │  - Connections (OAuth)        │  │    │  - agent (chat turn) │  │
│  │  │  - Settings (guardrails)     │  │    │  - memory search     │  │
│  │  └──────────────────────────────┘  │    └──────────────────────┘  │
│  │  ┌──────────────────────────────┐  │                              │
│  │  │ Server actions + API routes  │  │                              │
│  │  │  - createProjectAction       │  │                              │
│  │  │    (provisions 3 agents)     │  │                              │
│  │  │  - scheduleCronAction        │  │                              │
│  │  │  - pause/resume/deleteCron   │  │                              │
│  │  │  - archiveProjectAction      │  │                              │
│  │  │    (cascade-disables crons)  │  │                              │
│  │  │  - /api/chat (SSE)           │  │                              │
│  │  │  - /api/oauth/{provider}/*   │  │                              │
│  │  └──────────────────────────────┘  │                              │
│  │  ┌──────────────────────────────┐  │                              │
│  │  │ Local SQLite                 │  │                              │
│  │  │  ~/.notfair-cmo/db.sqlite    │  │                              │
│  │  │  - projects                  │  │                              │
│  │  │  - tasks (V0.2 wires up)     │  │                              │
│  │  │  - approvals (V0.2)          │  │                              │
│  │  │  - cost_events (V0.2)        │  │                              │
│  │  │  - oauth_tokens (encrypted)  │  │                              │
│  │  │  - guardrails (config)       │  │                              │
│  │  │  - agent_actions (audit log) │  │                              │
│  │  └──────────────────────────────┘  │                              │
│  └────────────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────────────┘
```

## Why this shape

**Don't rebuild the wheels.** OpenClaw already provides:
- Agent runtime (per-agent isolated workspaces, model fallback chains)
- Cron scheduler with agent attribution + run history
- Built-in memory subsystem with REM (reflective episodic memory)
- WebSocket gateway with auth modes
- MCP server registration framework
- Multi-channel delivery (Telegram, Slack, iMessage, etc.)

We don't reimplement any of that. notfair-cmo adds:
- A product-shaped chat + management UI scoped per marketing project
- A consistent naming convention (`<project> / <agent> / <cron>`) so OpenClaw's flat namespace becomes hierarchical to the user
- Local SQLite for product-specific state (tasks, approvals, cost events, OAuth tokens) that doesn't belong in OpenClaw's model
- AES-256-GCM encrypted OAuth token vault with OS-keychain master key

## Agent ↔ notfair-cmo interaction (V0.1)

Agents are taught (via system prompt in their workspace `IDENTITY.md`) to use OpenClaw's built-in `exec` tool to run `openclaw cron add ...` directly. The system prompt enforces the project-namespaced naming convention so our cron tab parses + groups correctly.

There is **no MCP server** in V0.1. We considered one but found agents have direct CLI access via `exec`, which made the MCP layer redundant.

V0.2 wires the autonomy/cost/approval features through MCP tools (the implementations exist as backend helpers — they just don't get exposed to agents yet).

## Distribution

- npm package (`notfair-cmo` bin)
- Next.js standalone build (`.next/standalone/server.js` shipped, started by `bin/cli.mjs`)
- Native deps: `better-sqlite3` (Node 24 prebuilds available), `keytar` (prebuilds for major platforms)
- Runtime requires: Node 20+, OpenClaw installed and gateway running

## Module map

```
bin/
  cli.mjs              # CLI entry: `notfair-cmo` (start, doctor, stop)

src/
  app/
    layout.tsx          # Root layout (TooltipProvider, Toaster)
    (app)/              # Sidebar-shell route group
      layout.tsx        # SidebarProvider + AppSidebar + main
      page.tsx          # Project home (KPIs + recent actions)
      chat/             # CMO chat (SSE-streamed)
      approvals/        # Approval inbox (V0.2 wires fully)
      tasks/            # Task board (V0.2 wires fully)
      crons/            # Cron tab — read+write via UI + agent exec
      connections/      # OAuth: Google Ads + GSC
      settings/         # Guardrails config
      projects/         # List + new
    onboarding/         # Magic moment (placeholder steps)
    api/
      chat/             # POST → SSE stream from openclaw agent
      oauth/            # OAuth start/callback for Google Ads, GSC
      projects/[slug]/provision/  # Re-provision agents

  server/
    active-project.ts    # cookie-backed current project
    actions/
      projects.ts        # create (+provision), archive (cascade), rename, switch
      crons.ts           # schedule, pause, resume, delete
      approvals.ts       # approve, reject (V0.2 fully wired)
      guardrails.ts      # update thresholds
    agent-templates.ts   # CMO / google_ads / seo definitions + IDENTITY.md writer
    openclaw/
      cli.ts             # subprocess wrapper: openclaw(args)
      agent-turn.ts      # streaming agent invocation
      crons.ts           # cron list parser + naming convention
    db/
      db.ts              # better-sqlite3 singleton + migration runner
      migrations.ts      # embedded SQL migrations (forward-only)
      projects.ts, tasks.ts, approvals.ts, cost.ts,
      oauth.ts, guardrails.ts, agent-actions.ts
    secrets/
      master-key.ts      # OS keychain (keytar) master key
      cipher.ts          # AES-256-GCM encrypt / decrypt

  components/
    app-sidebar.tsx      # Sidebar with project switcher + nav + cost meter
    project-switcher.tsx
    cost-meter.tsx       # Sidebar widget with hover breakdown
    cmo-chat.tsx         # Streamed chat with Stop button
    schedule-cron-dialog.tsx
    cron-row-actions.tsx
    approval-card.tsx
    onboarding-flow.tsx
    ui/                  # shadcn primitives

  lib/
    slug.ts              # slugify + reserved-word check
    utils.ts             # cn() for shadcn

  types/
    index.ts             # Project, Task, Approval, CostEvent, etc.
```

## What we deliberately don't have

- No auth, no sessions, no users table — single-user local
- No multi-tenancy, no RLS — single SQLite file
- No webhook signing / reconciliation — loopback only, trusted
- No MCP server (V0.1) — agents use OpenClaw's native `exec`
- No telemetry — opt-in only when added in a later version
- No Docker / Tauri distribution (V0.1) — npm only

## Trade-offs to know about

- **Agent name discipline depends on system prompt.** If the agent forgets the `<project> / <agent> / <name>` convention, the cron lands in our "ungrouped" bucket — graceful degradation, not broken.
- **Cost meter shows zero by default** until V0.2 wires in the AI SDK middleware that records LLM usage via our `record_cost` helper.
- **Approval inbox is a placeholder** until V0.2 wires the `approve_action` enforcement into agent flows.
- **No agent ↔ agent direct messaging.** Agents coordinate by reading each other's OpenClaw memory entries (which agents already do natively via `memory search`).
