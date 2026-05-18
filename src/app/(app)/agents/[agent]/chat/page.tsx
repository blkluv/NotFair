import { redirect, notFound } from "next/navigation";
import { getActiveProject } from "@/server/active-project";
import { resolveAgentBySlug } from "@/server/agent-meta";
import {
  listSessionsForAgent,
  newSessionId,
} from "@/server/openclaw/sessions";

/**
 * Default landing for /agents/[agent]/chat — pick a thread and redirect into
 * the per-thread URL so refresh/share/back-button all keep the thread context.
 */
export default async function ChatIndexPage({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent: agentSlug } = await params;
  const project = await getActiveProject();
  if (!project) {
    // No project means no agent workspace; let the threaded page render the
    // friendly empty state instead of bouncing through redirects.
    redirect(`/agents/${agentSlug}/chat/_pending`);
  }
  const resolved = await resolveAgentBySlug(project.slug, agentSlug);
  if (!resolved) notFound();

  const existing = listSessionsForAgent(resolved.agent_id);
  const target = existing[0]?.sessionId ?? newSessionId();
  redirect(`/agents/${agentSlug}/chat/${target}`);
}
