import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Approval, ApprovalStatus, ApprovalType } from "@/types";

export type CreateApprovalInput = {
  project_slug: string;
  agent_id: string;
  action_summary: string;
  action_type: ApprovalType;
  cost_estimate_usd: number;
  reasoning?: string | null;
  payload: unknown;
};

export function createApproval(input: CreateApprovalInput): Approval {
  const db = getDb();
  const approval: Approval = {
    id: randomUUID(),
    project_slug: input.project_slug,
    agent_id: input.agent_id,
    action_summary: input.action_summary,
    action_type: input.action_type,
    cost_estimate_usd: input.cost_estimate_usd,
    reasoning: input.reasoning ?? null,
    payload_json: JSON.stringify(input.payload ?? {}),
    status: "pending",
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  db.prepare(
    `INSERT INTO approvals
       (id, project_slug, agent_id, action_summary, action_type, cost_estimate_usd, reasoning, payload_json, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
  ).run(
    approval.id,
    approval.project_slug,
    approval.agent_id,
    approval.action_summary,
    approval.action_type,
    approval.cost_estimate_usd,
    approval.reasoning,
    approval.payload_json,
    approval.created_at,
  );
  return approval;
}

export function listPendingApprovals(project_slug: string): Approval[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM approvals WHERE project_slug = ? AND status = 'pending' ORDER BY created_at DESC",
    )
    .all(project_slug) as Approval[];
}

export function pendingApprovalCount(project_slug: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM approvals WHERE project_slug = ? AND status = 'pending'")
    .get(project_slug) as { n: number };
  return row.n;
}

export function resolveApproval(id: string, status: Exclude<ApprovalStatus, "pending">): Approval | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
  ).run(status, now, id);
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
  return (row as Approval) ?? null;
}
