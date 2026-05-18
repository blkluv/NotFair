"use server";

import { revalidatePath } from "next/cache";
import { setSkillEnabled } from "@/server/openclaw/gateway-rpc";

export type SetSkillEnabledResult = { ok: true } | { ok: false; error: string };

export async function setSkillEnabledAction(
  skillKey: string,
  enabled: boolean,
  agentSlug: string,
): Promise<SetSkillEnabledResult> {
  if (!skillKey) return { ok: false, error: "skillKey is required" };
  try {
    await setSkillEnabled(skillKey, enabled);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Skills config is workspace-wide, so any agent's skills tab needs to refresh.
  // Cheapest correct invalidation: revalidate the caller's page; user can refresh
  // other tabs themselves on the rare cross-agent reconfig.
  revalidatePath(`/agents/${agentSlug}/skills`);
  return { ok: true };
}
