# notfair-cmo

> Local AI marketing portal. Spin up specialist [OpenClaw](https://docs.openclaw.ai) marketing agents per project, chat with them, manage their scheduled work.

Open source. Runs entirely on your machine. Bring your own LLM credentials (via OpenClaw config) and your own ad-platform OAuth.

## What it gives you

- A **CMO chat** per project — talk to a marketing-shaped agent that can launch campaigns, audit SEO, kick off cron jobs.
- **Specialist agents** (Google Ads, SEO) auto-provisioned per project, isolated in their own OpenClaw workspaces.
- A **cron tab** that parses OpenClaw's cron list and groups it by project + agent so attribution is obvious.
- An **approval inbox** and **cost meter** sketched into the sidebar (placeholders in v0.1; live in v0.2 when autonomy guardrails wire up).
- **Connections** UI for OAuth (Google Ads, Google Search Console).

## Prerequisites

- **[OpenClaw](https://docs.openclaw.ai/install)** installed and the gateway running on this machine (`openclaw gateway`).
- **Node 20+** (Node 24 recommended).
- An LLM provider configured in your OpenClaw config (the project inherits `agents.defaults.model` — primary + fallbacks chain).

Run `notfair-cmo doctor` to verify all three.

## Install + run

```bash
# One-shot, no install:
npx notfair-cmo@latest doctor      # verify env
npx notfair-cmo@latest             # launch UI on localhost:3000

# Or install globally:
npm install -g notfair-cmo
notfair-cmo
```

The UI opens in your browser. Sidebar is project-scoped; create one to start.

## CLI

```
notfair-cmo                 Launch local server + open UI (default)
notfair-cmo start           Same as above
notfair-cmo doctor          Verify OpenClaw, gateway, data dir, LLM key
notfair-cmo --version
notfair-cmo --help
```

Options on `start`: `--port <n>`, `--no-open`, `--data-dir <path>`.

## What happens when you create a project

1. SQLite row written at `~/.notfair-cmo/db.sqlite`.
2. Three OpenClaw agents provisioned under the project's slug:
   - `<slug>-cmo` — Chief Marketing Officer
   - `<slug>-google-ads` — Google Ads specialist
   - `<slug>-seo` — SEO specialist
   Each gets its own workspace at `~/.notfair-cmo/agents/<name>/` and a `IDENTITY.md` system prompt scoped to its role.
3. You're redirected to the project home. Click **Chat with CMO** to start.

## Scheduling recurring work

Agents have OpenClaw's built-in `exec` tool, so they create their own cron jobs by running `openclaw cron add` with our naming convention. You can also schedule manually via the **+ New cron** button on the Crons tab.

Cron names follow `<project-slug> / <agent-slug> / <cron-slug>` so the tab can group them.

## OAuth setup (optional, for Google Ads / GSC agents to do real work)

The agents are useful in chat without OAuth, but to actually pull live data or push changes, register a Google Cloud OAuth app and set:

```bash
# In your shell or .env
export GOOGLE_ADS_CLIENT_ID="..."
export GOOGLE_ADS_CLIENT_SECRET="..."
export GSC_CLIENT_ID="..."
export GSC_CLIENT_SECRET="..."
```

Set the redirect URI in Google Cloud Console to `http://localhost:3000/api/oauth/google_ads/callback` (and similar for `gsc`). Then visit **Connections** in the UI and click **Connect**.

Tokens are AES-256-GCM encrypted with a master key stored in your OS keychain (via `keytar`) and persisted to your local SQLite.

## Data location

- App state: `~/.notfair-cmo/db.sqlite` (override with `--data-dir` or `NOTFAIR_CMO_DATA_DIR`)
- Agent workspaces: `~/.notfair-cmo/agents/<agent-name>/`
- OpenClaw config: `~/.openclaw/openclaw.json` (managed by OpenClaw, not us)

## What v0.1 is and isn't

**Is:** an agent runner + chat portal + cron management UI. Talk to project-scoped OpenClaw agents, schedule their recurring work, see attribution.

**Isn't (yet):** a fully autonomous CMO. The approval inbox, autonomy guardrails, automatic cost tracking, and cross-agent signal sharing are scaffolded but not wired. They land in v0.2.

See `ARCHITECTURE.md` for the design and `CONTRIBUTING.md` for development setup.

## License

MIT — see LICENSE.
