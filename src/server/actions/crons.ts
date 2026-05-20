"use server";

import { revalidatePath } from "next/cache";
import {
  createCron,
  disableCron,
  enableCron,
  invalidateCronCache,
  removeCron,
} from "@/server/openclaw/crons";
import { updateCronMessage } from "@/server/openclaw/gateway-rpc";
import { agentNameFor, type AgentTemplate } from "@/server/agent-templates";
import { slugify } from "@/lib/slug";
import { logAgentAction } from "@/server/db/agent-actions";

export type ScheduleCronInput = {
  project_slug: string;
  specialist: AgentTemplate["key"];
  name: string;
  schedule_kind: "cron" | "every";
  schedule_value: string;
  tz?: string;
  brief: string;
};

export type ScheduleCronResult =
  | { ok: true; cron_id: string; cron_name: string }
  | { ok: false; error: string };

export async function scheduleCronAction(input: ScheduleCronInput): Promise<ScheduleCronResult> {
  const nameSlug = slugify(input.name);
  if (!nameSlug.ok) return { ok: false, error: `Invalid name: ${nameSlug.reason}` };

  const briefTrimmed = input.brief.trim();
  if (!briefTrimmed) return { ok: false, error: "Brief is required." };

  const scheduleValueTrimmed = input.schedule_value.trim();
  if (!scheduleValueTrimmed) return { ok: false, error: "Schedule is required." };

  const agent_slug = input.specialist.replace(/_/g, "-");
  const agent_full_id = agentNameFor(input.project_slug, input.specialist);

  try {
    const result = await createCron({
      project_slug: input.project_slug,
      agent_slug,
      agent_full_id,
      cron_name: nameSlug.slug,
      schedule:
        input.schedule_kind === "cron"
          ? { kind: "cron", expr: scheduleValueTrimmed, tz: input.tz }
          : { kind: "every", duration: scheduleValueTrimmed },
      message: briefTrimmed,
    });
    logAgentAction({
      project_slug: input.project_slug,
      agent_id: agent_full_id,
      action_type: "cron_created",
      summary: `Scheduled '${nameSlug.slug}' (${input.schedule_kind} ${scheduleValueTrimmed})`,
      payload: { cron_id: result.id, cron_name: result.name, brief: briefTrimmed },
    });
    revalidatePath("/", "layout");
    revalidatePath("/", "layout");
    return { ok: true, cron_id: result.id, cron_name: result.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function pauseCronAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await disableCron(id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resumeCronAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await enableCron(id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteCronAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await removeCron(id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateCronPromptAction(
  id: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "Prompt cannot be empty." };
  try {
    await updateCronMessage(id, trimmed);
    invalidateCronCache();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
