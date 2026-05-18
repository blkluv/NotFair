import { getDb } from "./db";
import type { Guardrails } from "@/types";

export const DEFAULT_GUARDRAILS: Omit<Guardrails, "project_slug"> = {
  max_daily_spend_usd: 200,
  max_concurrent_experiments: 3,
  require_approval_above: {
    spend_per_action_usd: 50,
    new_channel_first_action: true,
    content_publishing: true,
    bid_changes_percent: 25,
    audience_change: true,
  },
};

export function getGuardrails(project_slug: string): Guardrails {
  const db = getDb();
  const row = db
    .prepare("SELECT config_json FROM guardrails WHERE project_slug = ?")
    .get(project_slug) as { config_json: string } | undefined;
  if (!row) return { project_slug, ...DEFAULT_GUARDRAILS };
  try {
    const parsed = JSON.parse(row.config_json) as Omit<Guardrails, "project_slug">;
    return { project_slug, ...parsed };
  } catch {
    return { project_slug, ...DEFAULT_GUARDRAILS };
  }
}

export function setGuardrails(g: Guardrails): void {
  const db = getDb();
  const { project_slug, ...config } = g;
  const config_json = JSON.stringify(config);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guardrails (project_slug, config_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_slug) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
  ).run(project_slug, config_json, now);
}
