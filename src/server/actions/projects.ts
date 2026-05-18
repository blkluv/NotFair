"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveProject, createProject, renameProject } from "@/server/db/projects";
import { setActiveProject } from "@/server/active-project";
import { ensureProjectAgents } from "@/server/agent-templates";
import { listCronsForProject, disableCron } from "@/server/openclaw/crons";
import { logAgentAction } from "@/server/db/agent-actions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Throws on validation failure so form action signature is `(formData) => Promise<void>`.
// Pages can render `error.tsx` for fallback; for inline UI feedback, wire `useActionState`
// in a client wrapper later if needed.
export async function createProjectAction(formData: FormData): Promise<void> {
  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) throw new Error("Please enter a project name.");

  const result = createProject({ display_name });
  if (!result.ok) throw new Error(result.reason);

  // Provision OpenClaw agents inline so the project is immediately usable.
  // If provisioning fails (e.g., OpenClaw down), the project row still exists
  // and the user can re-run provisioning from project home later.
  try {
    const prov = await ensureProjectAgents(result.project.slug);
    logAgentAction({
      project_slug: result.project.slug,
      agent_id: "system",
      action_type: "project_created",
      summary: `Project '${result.project.display_name}' created. ${prov.created.length} agents provisioned.`,
      payload: prov,
    });
  } catch (err) {
    console.error("Agent provisioning failed; project created but no agents:", err);
  }

  await setActiveProject(result.project.slug);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function reprovisionAgentsAction(slug: string): Promise<{ ok: true; created: string[]; existed: string[] } | { ok: false; error: string }> {
  try {
    const result = await ensureProjectAgents(slug);
    revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function switchProjectAction(slug: string): Promise<ActionResult> {
  await setActiveProject(slug);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function archiveProjectAction(
  slug: string,
): Promise<ActionResult<{ halted_crons: number }>> {
  const updated = archiveProject(slug);
  if (!updated) return { ok: false, error: "Project not found." };

  // Cascade: halt all OpenClaw crons matching this project's prefix.
  // Failure to halt is non-fatal; user can clean up manually via the cron tab.
  let halted = 0;
  try {
    const view = await listCronsForProject(slug);
    for (const group of view.groups) {
      for (const cron of group.crons) {
        if (cron.disabled) continue;
        try {
          await disableCron(cron.id);
          halted += 1;
        } catch (err) {
          console.error(`Failed to disable cron ${cron.id} during archive:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Could not list crons during project archive:", err);
  }

  logAgentAction({
    project_slug: slug,
    agent_id: "system",
    action_type: "project_archived",
    summary: `Project archived. ${halted} cron${halted === 1 ? "" : "s"} halted.`,
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { halted_crons: halted } };
}

export async function renameProjectAction(slug: string, display_name: string): Promise<ActionResult> {
  const updated = renameProject(slug, display_name);
  if (!updated) return { ok: false, error: "Project not found or name invalid." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
