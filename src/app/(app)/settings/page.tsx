import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getActiveProject } from "@/server/active-project";
import { getGuardrails } from "@/server/db/guardrails";
import { updateGuardrailsAction } from "@/server/actions/guardrails";
import { DangerZone } from "@/components/danger-zone";
import { ProjectRenameCard } from "@/components/project-rename-card";

export default async function SettingsPage() {
  const project = await getActiveProject();
  if (!project) {
    return (
      <div className="mx-auto max-w-md pt-12 text-sm text-muted-foreground">
        Select a project to edit its settings.
      </div>
    );
  }
  const g = getGuardrails(project.slug);
  const submit = updateGuardrailsAction.bind(null, project.slug);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Project <span className="font-mono">{project.slug}</span> · Autonomy guardrails
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Autonomy</CardTitle>
          <CardDescription>
            Defaults are conservative. Loosen as you build trust with the CMO.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="max_daily_spend_usd"
                label="Max daily spend (USD)"
                value={g.max_daily_spend_usd}
                help="Hard cap. Halts all autonomous spending at this limit."
              />
              <Field
                id="max_concurrent_experiments"
                label="Max concurrent experiments"
                value={g.max_concurrent_experiments}
                help="CMO won't launch more than this many at once."
              />
              <Field
                id="spend_per_action_usd"
                label="Approval needed above (USD/action)"
                value={g.require_approval_above.spend_per_action_usd}
                help="Single actions above this go to approval inbox."
              />
              <Field
                id="bid_changes_percent"
                label="Approval needed for bid change ≥ (%)"
                value={g.require_approval_above.bid_changes_percent}
                help="Big bid swings get human approval."
              />
            </div>

            <fieldset className="space-y-3 rounded-md border p-4">
              <legend className="px-1 text-xs uppercase text-muted-foreground">
                Always require approval for:
              </legend>
              <Toggle
                id="new_channel_first_action"
                label="First action in a new channel"
                checked={g.require_approval_above.new_channel_first_action}
              />
              <Toggle
                id="content_publishing"
                label="Content publishing (Reddit post, X tweet, email send)"
                checked={g.require_approval_above.content_publishing}
              />
              <Toggle
                id="audience_change"
                label="Audience / targeting changes"
                checked={g.require_approval_above.audience_change}
              />
            </fieldset>

            <Button type="submit">Save guardrails</Button>
          </form>
        </CardContent>
      </Card>

      <ProjectRenameCard
        currentSlug={project.slug}
        currentDisplayName={project.display_name}
      />

      <section className="space-y-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Danger zone
        </h2>
        <DangerZone projectSlug={project.slug} projectName={project.display_name} />
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  help,
}: {
  id: string;
  label: string;
  value: number;
  help: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="number" defaultValue={value} step="any" min={0} />
      <p className="text-[11px] text-muted-foreground">{help}</p>
    </div>
  );
}

function Toggle({ id, label, checked }: { id: string; label: string; checked: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <input id={id} name={id} type="checkbox" defaultChecked={checked} className="size-4" />
      <span>{label}</span>
    </label>
  );
}
