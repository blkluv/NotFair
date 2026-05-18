import { CronExpressionParser } from "cron-parser";
import type { DisplayCron } from "./crons";

export type CronOccurrence = {
  /** ms epoch */
  at: number;
  cron_id: string;
  cron_name: string;
  short_name: string;
  agent_id: string;
  agent_slug: string;
  schedule_text: string;
};

type ScheduleInput =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: string; [k: string]: unknown };

/**
 * Compute upcoming occurrences for one cron up to `until` (ms epoch).
 * Returns at most `maxPerCron` entries — high-frequency crons are capped so
 * we don't render thousands of chips for an every-second job.
 */
export function expandSchedule(
  cron_id: string,
  schedule: ScheduleInput | undefined,
  range: { from: number; until: number },
  meta: Pick<DisplayCron, "name" | "short_name" | "agent_id"> & { agent_slug: string; schedule_text: string },
  maxPerCron = 60,
): CronOccurrence[] {
  if (!schedule) return [];
  const { from, until } = range;
  const out: CronOccurrence[] = [];

  const make = (at: number): CronOccurrence => ({
    at,
    cron_id,
    cron_name: meta.name,
    short_name: meta.short_name,
    agent_id: meta.agent_id,
    agent_slug: meta.agent_slug,
    schedule_text: meta.schedule_text,
  });

  if (schedule.kind === "cron" && typeof (schedule as { expr?: unknown }).expr === "string") {
    const s = schedule as { expr: string; tz?: string };
    try {
      const it = CronExpressionParser.parse(s.expr, {
        currentDate: new Date(from),
        endDate: new Date(until),
        tz: s.tz,
      });
      while (out.length < maxPerCron) {
        try {
          const next = it.next();
          out.push(make(next.toDate().getTime()));
        } catch {
          break;
        }
      }
    } catch {
      return [];
    }
    return out;
  }

  if (schedule.kind === "every" && typeof (schedule as { everyMs?: unknown }).everyMs === "number") {
    const s = schedule as { everyMs: number; anchorMs?: number };
    if (s.everyMs <= 0) return [];
    const anchor = typeof s.anchorMs === "number" ? s.anchorMs : from;
    // First occurrence at or after `from`.
    let next = anchor;
    if (anchor < from) {
      const k = Math.ceil((from - anchor) / s.everyMs);
      next = anchor + k * s.everyMs;
    }
    while (next <= until && out.length < maxPerCron) {
      out.push(make(next));
      next += s.everyMs;
    }
    return out;
  }

  return [];
}

/**
 * Expand a list of crons into a flat occurrence list grouped by day-of-week.
 * Days are in user local time (matches what the user sees in the calendar).
 */
export function groupOccurrencesByDay(
  occurrences: CronOccurrence[],
  startOfFirstDay: number,
  numDays: number,
): CronOccurrence[][] {
  const days: CronOccurrence[][] = Array.from({ length: numDays }, () => []);
  const dayMs = 24 * 60 * 60 * 1000;
  for (const o of occurrences) {
    const dayIndex = Math.floor((o.at - startOfFirstDay) / dayMs);
    if (dayIndex < 0 || dayIndex >= numDays) continue;
    days[dayIndex]!.push(o);
  }
  for (const day of days) day.sort((a, b) => a.at - b.at);
  return days;
}
