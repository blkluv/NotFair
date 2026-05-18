"use server";

import { revalidatePath } from "next/cache";
import { getActiveProject } from "@/server/active-project";
import { templateForUrlSlug } from "@/server/agent-templates";
import { newSessionId, setActiveSession } from "@/server/openclaw/sessions";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * "New thread" = mint a UUID, set it as active. OpenClaw creates the actual
 * session entry on the first agent turn under that UUID. We do not persist
 * anything ourselves.
 */
export async function newSessionAction(agentSlug: string): Promise<Result<{ sessionId: string }>> {
  const project = await getActiveProject();
  if (!project) return { ok: false, error: "No active project." };
  const template = templateForUrlSlug(agentSlug);
  if (!template) return { ok: false, error: `Unknown agent: ${agentSlug}` };

  const sessionId = newSessionId();
  await setActiveSession(project.slug, template.key, sessionId);
  revalidatePath(`/chat/${agentSlug}`);
  return { ok: true, data: { sessionId } };
}

export async function switchSessionAction(
  agentSlug: string,
  sessionId: string,
): Promise<Result<{ sessionId: string }>> {
  const project = await getActiveProject();
  if (!project) return { ok: false, error: "No active project." };
  const template = templateForUrlSlug(agentSlug);
  if (!template) return { ok: false, error: `Unknown agent: ${agentSlug}` };
  await setActiveSession(project.slug, template.key, sessionId);
  revalidatePath(`/chat/${agentSlug}`);
  return { ok: true, data: { sessionId } };
}
