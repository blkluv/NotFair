import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveProject } from "@/server/active-project";
import {
  templateForUrlSlug,
  agentNameFor,
} from "@/server/agent-templates";
import { getSessionsView, loadSessionHistory } from "@/server/openclaw/sessions";
import { AgentChat } from "@/components/agent-chat";
import { ThreadSelector } from "@/components/thread-selector";

type Params = { agent: string };

export default async function AgentChatPage({ params }: { params: Promise<Params> }) {
  const { agent: agentSlug } = await params;
  const template = templateForUrlSlug(agentSlug);
  if (!template) notFound();

  const project = await getActiveProject();
  if (!project) {
    return (
      <div className="mx-auto max-w-md p-6 pt-12">
        <Card>
          <CardHeader>
            <CardTitle>No active project</CardTitle>
            <CardDescription>
              Create a project before chatting with the {template.display_name} agent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/projects/new" className="text-sm underline">
              Create one
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const agentFullId = agentNameFor(project.slug, template.key);
  const sessionsView = await getSessionsView(project.slug, template.key);
  const history = sessionsView.active.pending
    ? []
    : loadSessionHistory(agentFullId, sessionsView.active.sessionId);

  return (
    <>
      {/* Top bar — agent identity + thread selector. Does not scroll. */}
      <header className="flex items-center gap-3 border-b bg-background/80 px-6 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight">
              {template.display_name}
            </h1>
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
              {agentFullId}
            </span>
          </div>
        </div>
        <ThreadSelector
          agentSlug={agentSlug}
          sessions={sessionsView.all}
          activeSessionId={sessionsView.active.sessionId}
        />
      </header>

      {/* Chat fills the remaining height. min-h-0 so the inner scroll works. */}
      <div className="min-h-0 flex-1">
        <AgentChat
          key={sessionsView.active.sessionId}
          projectSlug={project.slug}
          agentSlug={agentSlug}
          agentDisplayName={template.display_name}
          sessionId={sessionsView.active.sessionId}
          initialMessages={history.map((m) => ({ id: m.id, role: m.role, body: m.body }))}
        />
      </div>
    </>
  );
}
