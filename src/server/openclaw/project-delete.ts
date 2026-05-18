import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentTemplate } from "@/server/agent-templates";
import { listProjectAgents } from "@/server/agent-meta";
import { listSessionsForAgent } from "@/server/openclaw/sessions";
import { listCronsForProject } from "@/server/openclaw/crons";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");

export type ProjectDeletionAgentSummary = {
  /** Template key when this agent came from a bootstrap template, else undefined. */
  template?: AgentTemplate["key"];
  display_name: string;
  agentId: string;
  exists: boolean;
  threadCount: number;
};

export type ProjectDeletionSummary = {
  project_slug: string;
  agents: ProjectDeletionAgentSummary[];
  totals: {
    agents: number;
    threads: number;
    crons: number;
  };
};

/**
 * Inventory everything tied to a project so the confirmation dialog can show
 * the user exactly what will be deleted. Reads-only; no mutations.
 *
 * Source of truth: `listProjectAgents()` — covers bootstrap templates AND any
 * cloned/custom agents created via the `+` button. Iterating TEMPLATES alone
 * would silently skip user-created agents and leak them after project delete.
 */
export async function getProjectDeletionSummary(
  project_slug: string,
): Promise<ProjectDeletionSummary> {
  const entries = await listProjectAgents(project_slug);
  const agents: ProjectDeletionAgentSummary[] = entries.map((e) => {
    const agentDir = join(OPENCLAW_HOME, "agents", e.agent_id);
    const exists = existsSync(agentDir);
    const threadCount = exists ? listSessionsForAgent(e.agent_id).length : 0;
    return {
      template: e.template_key,
      display_name: e.display_name,
      agentId: e.agent_id,
      exists,
      threadCount,
    };
  });

  let cronCount = 0;
  try {
    const cronView = await listCronsForProject(project_slug);
    cronCount = cronView.groups.reduce((acc, g) => acc + g.crons.length, 0);
  } catch {
    // OpenClaw cron service unreachable — show 0 and let the user decide.
  }

  return {
    project_slug,
    agents,
    totals: {
      agents: agents.filter((a) => a.exists).length,
      threads: agents.reduce((acc, a) => acc + a.threadCount, 0),
      crons: cronCount,
    },
  };
}
