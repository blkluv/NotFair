import { notFound, redirect } from "next/navigation";

import { readAgentMeta } from "@/server/agent-meta";
import { getProject } from "@/server/db/projects";
import { getTask } from "@/server/db/tasks";
import { urlSlugForTemplate, type AgentTemplateKey } from "@/server/agent-templates";
import { projectHref } from "@/lib/project-href";

/**
 * Deep-link destination for task IDs. The canonical view lives in the agent
 * workspace, so we resolve the task's owning agent and redirect there with
 * the task pre-selected. Keeps existing orchestration-summary links + emails
 * + bookmarks working through the rework.
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string; project: string }>;
}) {
  const { id, project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();

  const task = getTask(id);
  if (!task || task.project_slug !== project.slug) notFound();

  // Resolve the assignee's URL slug. Templates predate cloned agents — fall
  // back to the template default if no per-agent slug is stored.
  const meta = await readAgentMeta(task.agent_id);
  const templateKey = (meta?.template_key as AgentTemplateKey | undefined) ?? "google_ads";
  const agentSlug = meta?.slug ?? urlSlugForTemplate(templateKey);

  // Use the human-readable display_id in the canonical URL so the path
  // someone bookmarks reads "?task=demo7-3" not a UUID. getTask in the
  // workspace accepts either form, so legacy UUID deep-links still resolve.
  redirect(
    projectHref(slug, `/agents/${agentSlug}/tasks?task=${task.display_id}`),
  );
}
