import { notFound } from "next/navigation";
import { getActiveProject } from "@/server/active-project";
import { resolveAgentBySlug } from "@/server/agent-meta";
import { AgentTabs } from "@/components/agent-tabs";

type Params = { agent: string };

export default async function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<Params>;
}) {
  const { agent: agentSlug } = await params;
  const project = await getActiveProject();
  const resolved = project ? await resolveAgentBySlug(project.slug, agentSlug) : null;
  if (!resolved) notFound();

  return (
    // Escape parent main's p-6 so the tab strip + content area can own the
    // full viewport region. Children pick their own scroll/padding strategy.
    <div className="absolute inset-0 flex flex-col">
      <AgentTabs agentSlug={agentSlug} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
