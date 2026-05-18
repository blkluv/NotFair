import Link from "next/link";
import { Bot, Check, MessageSquare, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActiveProject } from "@/server/active-project";
import {
  TEMPLATES,
  urlSlugForTemplate,
  agentNameFor,
  type AgentTemplateKey,
} from "@/server/agent-templates";
import { listCronsForProject } from "@/server/openclaw/crons";
import { reprovisionAgentsAction } from "@/server/actions/projects";
import { ReprovisionButton } from "@/components/reprovision-button";

export default async function AgentsPage() {
  const project = await getActiveProject();
  if (!project) {
    return (
      <div className="mx-auto max-w-md pt-12 text-sm text-muted-foreground">
        Select a project to see its agents.
      </div>
    );
  }

  // Best-effort cron count per agent.
  const cronByAgent = new Map<string, number>();
  try {
    const view = await listCronsForProject(project.slug);
    for (const g of view.groups) cronByAgent.set(g.agent, g.crons.length);
  } catch {}

  // Bind the project slug into the server action for the client button.
  const reprovision = reprovisionAgentsAction.bind(null, project.slug);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Project <span className="font-mono">{project.slug}</span> · {TEMPLATES.length}{" "}
            agents available · all running on OpenClaw with your configured model + fallback chain
          </p>
        </div>
        <ReprovisionButton action={reprovision} />
      </header>

      <div className="grid gap-4">
        {TEMPLATES.map((t) => {
          const slug = urlSlugForTemplate(t.key as AgentTemplateKey);
          const fullId = agentNameFor(project.slug, t.key as AgentTemplateKey);
          const crons = cronByAgent.get(slug) ?? 0;
          return (
            <Card key={t.key}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Bot className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h2 className="text-base font-semibold">{t.display_name}</h2>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {fullId}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {crons > 0 && (
                    <Link
                      href="/crons"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Clock className="size-3" />
                      {crons}
                    </Link>
                  )}
                  <Button asChild size="sm">
                    <Link href={`/chat/${slug}`}>
                      <MessageSquare className="mr-1.5 size-4" />
                      Chat
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 gap-1.5 text-sm md:grid-cols-2">
                  {t.capabilities.map((c) => (
                    <li key={c} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
