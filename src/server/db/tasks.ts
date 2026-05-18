import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Task, TaskStatus } from "@/types";

export type CreateTaskInput = {
  project_slug: string;
  agent_id: string;
  brief: string;
  success_criteria?: string | null;
  deadline_iso?: string | null;
  status?: TaskStatus;
};

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    project_slug: input.project_slug,
    agent_id: input.agent_id,
    brief: input.brief,
    success_criteria: input.success_criteria ?? null,
    deadline_iso: input.deadline_iso ?? null,
    status: input.status ?? "proposed",
    result_json: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO tasks
       (id, project_slug, agent_id, brief, success_criteria, deadline_iso, status, result_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    task.id,
    task.project_slug,
    task.agent_id,
    task.brief,
    task.success_criteria,
    task.deadline_iso,
    task.status,
    task.created_at,
    task.updated_at,
  );
  return task;
}

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return (row as Task) ?? null;
}

export function listTasks(project_slug: string, status?: TaskStatus): Task[] {
  const db = getDb();
  if (status) {
    return db
      .prepare("SELECT * FROM tasks WHERE project_slug = ? AND status = ? ORDER BY created_at DESC")
      .all(project_slug, status) as Task[];
  }
  return db
    .prepare("SELECT * FROM tasks WHERE project_slug = ? ORDER BY created_at DESC")
    .all(project_slug) as Task[];
}

export type UpdateTaskInput = {
  status?: TaskStatus;
  result?: unknown;
  error_message?: string | null;
};

export function updateTask(id: string, update: UpdateTaskInput): Task | null {
  const db = getDb();
  const now = new Date().toISOString();
  const current = getTask(id);
  if (!current) return null;

  const result_json = update.result !== undefined ? JSON.stringify(update.result) : current.result_json;
  const error_message = update.error_message !== undefined ? update.error_message : current.error_message;
  const status = update.status ?? current.status;

  db.prepare(
    "UPDATE tasks SET status = ?, result_json = ?, error_message = ?, updated_at = ? WHERE id = ?",
  ).run(status, result_json, error_message, now, id);

  return getTask(id);
}
