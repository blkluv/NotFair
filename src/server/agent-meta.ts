import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  TEMPLATES,
  agentNameFor,
  urlSlugForTemplate,
  type AgentTemplateKey,
} from "./agent-templates";

/**
 * Per-agent meta we own (notfair-cmo) and store next to the agent's workspace
 * directory. OpenClaw doesn't have a place for our UI-facing display name +
 * project linkage, so this sidecar fills the gap without requiring a DB
 * migration. Authored at agent creation/clone time, read by the sidebar.
 */

export type AgentMeta = {
  /** Full OpenClaw agentId, e.g. `acme-cmo` or `acme-supa-clone`. */
  agent_id: string;
  /** Project slug this agent belongs to. */
  project_slug: string;
  /** URL-friendly slug (post-project prefix), e.g. `cmo`, `supa-clone`. */
  slug: string;
  /** Display name shown in sidebar / chat headers. */
  display_name: string;
  /** If from one of our bootstrap templates, which one. */
  template_key?: AgentTemplateKey;
  /** When cloned, the source agentId. */
  source_agent_id?: string;
  created_at: string;
};

function notfairDataDir(): string {
  return process.env.NOTFAIR_CMO_DATA_DIR ?? join(homedir(), ".notfair-cmo");
}

function metaPath(agentId: string): string {
  return join(notfairDataDir(), "agents", agentId, "notfair-meta.json");
}

export async function writeAgentMeta(meta: AgentMeta): Promise<void> {
  const path = metaPath(meta.agent_id);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(meta, null, 2), "utf8");
}

export function readAgentMeta(agentId: string): AgentMeta | null {
  const path = metaPath(agentId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentMeta;
  } catch {
    return null;
  }
}

export type ProjectAgentEntry = {
  agent_id: string;
  slug: string;
  display_name: string;
  description?: string;
  template_key?: AgentTemplateKey;
  source_agent_id?: string;
  is_template_default: boolean;
};

/**
 * List agents for a project. Source of truth:
 * - notfair-meta.json sidecars under `<DATA_DIR>/agents/<projectSlug>-*`.
 * - For each TEMPLATE not yet present on disk, fall back to a synthesized
 *   default entry so the user sees the bootstrap agents immediately even
 *   before `ensureProjectAgents` runs.
 */
export async function listProjectAgents(project_slug: string): Promise<ProjectAgentEntry[]> {
  const result = new Map<string, ProjectAgentEntry>();

  // 1) Seed with templates (they may or may not exist on disk yet).
  for (const t of TEMPLATES) {
    const agentId = agentNameFor(project_slug, t.key);
    result.set(agentId, {
      agent_id: agentId,
      slug: urlSlugForTemplate(t.key),
      display_name: t.display_name,
      description: t.description,
      template_key: t.key,
      is_template_default: true,
    });
  }

  // 2) Overlay anything we have meta for (template agents written by
  //    ensureProjectAgents, plus cloned/custom agents).
  const agentsRoot = join(notfairDataDir(), "agents");
  let entries: string[] = [];
  try {
    entries = await readdir(agentsRoot);
  } catch {
    // No agents dir yet — keep templates-only view.
    return Array.from(result.values());
  }
  const prefix = `${project_slug}-`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const meta = readAgentMeta(entry);
    if (!meta) continue;
    result.set(meta.agent_id, {
      agent_id: meta.agent_id,
      slug: meta.slug,
      display_name: meta.display_name,
      template_key: meta.template_key,
      source_agent_id: meta.source_agent_id,
      is_template_default: false,
    });
  }

  // Stable order: templates first (in declared order), then custom by slug.
  const templateOrder = new Map(TEMPLATES.map((t, i) => [t.key, i]));
  return Array.from(result.values()).sort((a, b) => {
    const ai = a.template_key ? templateOrder.get(a.template_key) ?? 99 : 99;
    const bi = b.template_key ? templateOrder.get(b.template_key) ?? 99 : 99;
    if (ai !== bi) return ai - bi;
    return a.slug.localeCompare(b.slug);
  });
}

/** Workspace dir we hand to OpenClaw at creation time. */
export function workspaceDirFor(agentId: string): string {
  return join(notfairDataDir(), "agents", agentId);
}

export type ResolvedAgent = {
  agent_id: string;
  display_name: string;
  slug: string;
  template_key?: AgentTemplateKey;
};

/**
 * Resolve a URL slug to its full agent_id within the current project. Looks
 * up templates first, then any cloned/custom agents via the meta sidecar.
 * Returns null when no project agent matches the slug.
 */
export async function resolveAgentBySlug(
  project_slug: string,
  url_slug: string,
): Promise<ResolvedAgent | null> {
  const all = await listProjectAgents(project_slug);
  const hit = all.find((a) => a.slug === url_slug);
  if (!hit) return null;
  return {
    agent_id: hit.agent_id,
    display_name: hit.display_name,
    slug: hit.slug,
    template_key: hit.template_key,
  };
}
