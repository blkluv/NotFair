import { redirect, notFound } from "next/navigation";
import { getProject } from "@/server/db/projects";
import { resolveAgentBySlug } from "@/server/agent-meta";
import {
  listSessionsForAgent,
  newSessionId,
} from "@/server/openclaw/sessions";
import { projectHref } from "@/lib/project-href";

/**
 * Default landing for /<project>/agents/[agent]/chat — pick a thread and
 * redirect into the per-thread URL so refresh/share/back-button all keep
 * the thread context.
 */
export default async function ChatIndexPage({
  params,
}: {
  params: Promise<{ agent: string; project: string }>;
}) {
  const { agent: agentSlug, project: projectSlug } = await params;
  const project = getProject(projectSlug);
  if (!project || project.archived_at) notFound();
  const resolved = await resolveAgentBySlug(project.slug, agentSlug);
  if (!resolved) notFound();

  const existing = listSessionsForAgent(resolved.agent_id);
  const target = existing[0]?.sessionId ?? newSessionId();
  redirect(projectHref(projectSlug, `/agents/${agentSlug}/chat/${target}`));
}
