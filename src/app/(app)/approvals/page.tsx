import { Card, CardContent } from "@/components/ui/card";
import { getActiveProject } from "@/server/active-project";
import { listPendingApprovals } from "@/server/db/approvals";
import { ApprovalCard } from "@/components/approval-card";

export default async function ApprovalsPage() {
  const project = await getActiveProject();

  if (!project) {
    return (
      <div className="mx-auto max-w-md pt-12 text-sm text-muted-foreground">
        Select a project to see its pending approvals.
      </div>
    );
  }

  const pending = listPendingApprovals(project.slug);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Project <span className="font-mono">{project.slug}</span> · {pending.length} pending
        </p>
      </header>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <h2 className="text-lg font-medium">All caught up.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              CMO will surface decisions here. Items above your thresholds appear
              here for approval. Adjust thresholds in{" "}
              <a href="/settings" className="underline">
                Settings
              </a>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}
    </div>
  );
}
