import { Card, CardContent } from "@/components/ui/card";
import { getActiveProject } from "@/server/active-project";
import { listCronsForProject } from "@/server/openclaw/crons";
import { expandSchedule } from "@/server/openclaw/cron-schedule";
import { ScheduleCronDialog } from "@/components/schedule-cron-dialog";
import {
  CronCalendar,
  type CalendarCron,
  type CalendarOccurrence,
} from "@/components/cron-calendar";

const NUM_DAYS = 14; // 2-week window; UI shows 7 at a time with prev/next.

export default async function CronsPage() {
  const project = await getActiveProject();
  if (!project) {
    return (
      <div className="mx-auto max-w-md pt-12 text-sm text-muted-foreground">
        Select a project to see its scheduled work.
      </div>
    );
  }

  let error: string | null = null;
  let view: Awaited<ReturnType<typeof listCronsForProject>>;
  try {
    view = await listCronsForProject(project.slug);
  } catch (err) {
    view = { project_slug: project.slug, groups: [] };
    error = err instanceof Error ? err.message : String(err);
  }

  // Flatten crons + agent slugs for the calendar.
  const allCrons = view.groups.flatMap((g) => g.crons);
  const agentSlugs = view.groups.map((g) => g.agent);

  // Compute the time window: today 00:00 local → +NUM_DAYS.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfFirstDay = today.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const until = startOfFirstDay + NUM_DAYS * dayMs;

  // Expand every cron into occurrences within the window.
  const occurrences: CalendarOccurrence[] = [];
  for (const cron of allCrons) {
    if (cron.disabled) continue;
    const occs = expandSchedule(
      cron.id,
      cron.schedule_raw,
      { from: Date.now(), until },
      {
        name: cron.name,
        short_name: cron.short_name,
        agent_id: cron.agent_id,
        agent_slug: cron.agent_slug,
        schedule_text: cron.schedule_text,
      },
    );
    for (const o of occs) occurrences.push(o);
  }

  const cronsById: Record<string, CalendarCron> = {};
  for (const cron of allCrons) {
    cronsById[cron.id] = {
      id: cron.id,
      short_name: cron.short_name,
      full_name: cron.name,
      agent_id: cron.agent_id,
      agent_slug: cron.agent_slug,
      schedule_text: cron.schedule_text,
      disabled: cron.disabled,
      status_text: cron.status_text,
    };
  }

  const totalActive = allCrons.filter((c) => !c.disabled).length;
  const totalDisabled = allCrons.length - totalActive;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crons</h1>
          <p className="text-sm text-muted-foreground">
            Project <span className="font-mono">{project.slug}</span> ·{" "}
            {totalActive} active{totalDisabled > 0 ? ` · ${totalDisabled} paused` : ""} ·{" "}
            backed by OpenClaw
          </p>
        </div>
        <ScheduleCronDialog projectSlug={project.slug} />
      </header>

      {error && (
        <Card>
          <CardContent className="py-6 text-sm">
            <p className="font-medium text-destructive">Could not reach OpenClaw.</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs">
              Run <code className="rounded bg-muted px-1.5 py-0.5">notfair-cmo doctor</code> for help.
            </p>
          </CardContent>
        </Card>
      )}

      {!error && allCrons.length === 0 && (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <h2 className="text-base font-medium">No scheduled work yet.</h2>
            <p className="text-sm text-muted-foreground">
              Schedule a recurring job for one of this project&rsquo;s agents.
            </p>
            <div className="flex justify-center pt-2">
              <ScheduleCronDialog projectSlug={project.slug} />
            </div>
          </CardContent>
        </Card>
      )}

      {!error && allCrons.length > 0 && (
        <CronCalendar
          startOfFirstDay={startOfFirstDay}
          numDays={NUM_DAYS}
          occurrences={occurrences}
          cronsById={cronsById}
          agentSlugs={agentSlugs}
        />
      )}
    </div>
  );
}
