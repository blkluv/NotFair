"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { colorForAgentSlug } from "@/lib/agent-colors";
import {
  pauseCronAction,
  resumeCronAction,
  deleteCronAction,
} from "@/server/actions/crons";

/**
 * Pre-computed cron occurrence used by the calendar. Server computes these
 * with `expandSchedule()` so the client just renders.
 */
export type CalendarOccurrence = {
  at: number;
  cron_id: string;
  cron_name: string;
  short_name: string;
  agent_id: string;
  agent_slug: string;
  schedule_text: string;
};

export type CalendarCron = {
  id: string;
  short_name: string;
  full_name: string;
  agent_id: string;
  agent_slug: string;
  schedule_text: string;
  disabled: boolean;
  status_text: string;
};

type Props = {
  /** ms epoch of the first day shown (00:00 local). */
  startOfFirstDay: number;
  numDays: number;
  occurrences: CalendarOccurrence[];
  cronsById: Record<string, CalendarCron>;
  /** Distinct agents for the legend. */
  agentSlugs: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function CronCalendar({
  startOfFirstDay,
  numDays,
  occurrences,
  cronsById,
  agentSlugs,
}: Props) {
  const [focusDayOffset, setFocusDayOffset] = useState(0);
  const [selected, setSelected] = useState<CalendarOccurrence | null>(null);

  // Group occurrences into days. Memoize because we slice the same data on
  // every state change.
  const days = useMemo(() => {
    const buckets: CalendarOccurrence[][] = Array.from(
      { length: numDays },
      () => [],
    );
    for (const o of occurrences) {
      const idx = Math.floor((o.at - startOfFirstDay) / DAY_MS);
      if (idx >= 0 && idx < numDays) buckets[idx]!.push(o);
    }
    for (const day of buckets) day.sort((a, b) => a.at - b.at);
    return buckets;
  }, [occurrences, numDays, startOfFirstDay]);

  // 7-day window navigation (we keep numDays at 14 to allow scrolling).
  const visibleDays = Math.min(7, numDays);
  const offsetMax = Math.max(0, numDays - visibleDays);
  const clampedOffset = Math.max(0, Math.min(focusDayOffset, offsetMax));

  const selectedCron = selected ? cronsById[selected.cron_id] : null;

  return (
    <>
      <div className="space-y-3">
        {/* Legend + window navigator */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            {agentSlugs.map((slug) => {
              const color = colorForAgentSlug(slug);
              return (
                <div key={slug} className="flex items-center gap-1.5 text-xs">
                  <span className={cn("inline-block size-2 rounded-full", color.dot)} />
                  <span className="font-mono text-muted-foreground">{slug}</span>
                </div>
              );
            })}
            {agentSlugs.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No agents have scheduled work in this window.
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setFocusDayOffset((o) => Math.max(0, o - visibleDays))}
              disabled={clampedOffset === 0}
              aria-label="Previous week"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setFocusDayOffset(0)}
              disabled={clampedOffset === 0}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setFocusDayOffset((o) => Math.min(offsetMax, o + visibleDays))}
              disabled={clampedOffset >= offsetMax}
              aria-label="Next week"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Day grid */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <div
            className="grid divide-x"
            style={{ gridTemplateColumns: `repeat(${visibleDays}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: visibleDays }).map((_, i) => {
              const dayIndex = clampedOffset + i;
              const dayStart = startOfFirstDay + dayIndex * DAY_MS;
              const dayOccs = days[dayIndex] ?? [];
              return (
                <DayColumn
                  key={dayIndex}
                  dayStart={dayStart}
                  occurrences={dayOccs}
                  onSelect={(o) => setSelected(o)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <CronDetailDialog
        occurrence={selected}
        cron={selectedCron}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

// --- Day column ---

function DayColumn({
  dayStart,
  occurrences,
  onSelect,
}: {
  dayStart: number;
  occurrences: CalendarOccurrence[];
  onSelect: (o: CalendarOccurrence) => void;
}) {
  const date = new Date(dayStart);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const dayLabel = date.toLocaleDateString(undefined, { weekday: "short" });
  const dateLabel = date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });

  return (
    <div className="flex min-h-[280px] flex-col">
      <div
        className={cn(
          "border-b px-2 py-1.5 text-center",
          isToday && "bg-accent/30",
        )}
      >
        <div
          className={cn(
            "text-[10px] uppercase tracking-wide text-muted-foreground",
            isToday && "text-foreground font-medium",
          )}
        >
          {dayLabel}
        </div>
        <div
          className={cn(
            "text-sm tabular-nums",
            isToday ? "font-semibold text-foreground" : "text-foreground/80",
          )}
        >
          {dateLabel}
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
        {occurrences.length === 0 ? (
          <div className="flex h-full items-center justify-center pb-6">
            <span className="text-[10px] text-muted-foreground/60">·</span>
          </div>
        ) : (
          occurrences.map((o, idx) => (
            <OccurrenceChip
              key={`${o.cron_id}-${o.at}-${idx}`}
              occurrence={o}
              onClick={() => onSelect(o)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OccurrenceChip({
  occurrence,
  onClick,
}: {
  occurrence: CalendarOccurrence;
  onClick: () => void;
}) {
  const color = colorForAgentSlug(occurrence.agent_slug);
  const time = new Date(occurrence.at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors hover:brightness-95",
        color.chip,
      )}
      title={`${occurrence.cron_name} · ${occurrence.schedule_text}`}
    >
      <div className="tabular-nums font-medium">{time}</div>
      <div className="truncate opacity-80">{occurrence.short_name}</div>
    </button>
  );
}

// --- Detail dialog with pause/resume/delete ---

function CronDetailDialog({
  occurrence,
  cron,
  onClose,
}: {
  occurrence: CalendarOccurrence | null;
  cron: CalendarCron | null;
  onClose: () => void;
}) {
  if (!occurrence || !cron) return null;
  return (
    <Dialog open={!!occurrence} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{cron.short_name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {cron.full_name}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Agent</dt>
          <dd className="font-mono text-xs">{cron.agent_id}</dd>

          <dt className="text-muted-foreground">Schedule</dt>
          <dd className="font-mono text-xs">{cron.schedule_text}</dd>

          <dt className="text-muted-foreground">This occurrence</dt>
          <dd className="tabular-nums">
            {new Date(occurrence.at).toLocaleString()}
          </dd>

          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Badge variant={cron.disabled ? "outline" : "secondary"} className="text-[10px]">
              {cron.disabled ? "paused" : cron.status_text}
            </Badge>
          </dd>
        </dl>

        <DialogFooter className="gap-2 sm:gap-2">
          <CronActions cronId={cron.id} cronName={cron.short_name} disabled={cron.disabled} onAfter={onClose} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CronActions({
  cronId,
  cronName,
  disabled,
  onAfter,
}: {
  cronId: string;
  cronName: string;
  disabled: boolean;
  onAfter: () => void;
}) {
  function run(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    void (async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? `Failed to ${label}`);
      else toast.success(`${label}: ${cronName}`);
      onAfter();
    })();
  }

  return (
    <>
      {disabled ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => run("Resumed", () => resumeCronAction(cronId))}
        >
          <Play className="mr-1.5 size-3.5" />
          Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => run("Paused", () => pauseCronAction(cronId))}
        >
          <Pause className="mr-1.5 size-3.5" />
          Pause
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (typeof window !== "undefined" && !window.confirm(`Delete cron "${cronName}"?`)) return;
          run("Deleted", () => deleteCronAction(cronId));
        }}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="mr-1.5 size-3.5" />
        Delete
      </Button>
      <Button asChild variant="ghost" size="sm">
        <a
          href={`https://docs.openclaw.ai/cli/cron`}
          target="_blank"
          rel="noreferrer"
          className="text-xs"
        >
          <ExternalLink className="mr-1 size-3" />
          OpenClaw docs
        </a>
      </Button>
    </>
  );
}
