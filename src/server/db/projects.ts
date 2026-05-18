import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { Project } from "@/types";
import { slugify } from "@/lib/slug";

export type CreateProjectInput = {
  display_name: string;
  slug?: string;
};

export type CreateProjectResult =
  | { ok: true; project: Project }
  | { ok: false; reason: string };

export function listProjects(opts: { includeArchived?: boolean } = {}): Project[] {
  const db = getDb();
  const sql = opts.includeArchived
    ? "SELECT * FROM projects ORDER BY created_at DESC"
    : "SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC";
  return db.prepare(sql).all() as Project[];
}

export function getProject(slug: string): Project | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
  return (row as Project) ?? null;
}

export function createProject(input: CreateProjectInput): CreateProjectResult {
  const db = getDb();
  const slugInput = input.slug ?? input.display_name;
  const slug = slugify(slugInput);
  if (!slug.ok) return { ok: false, reason: slug.reason };

  const existing = db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug.slug);
  if (existing) return { ok: false, reason: `project slug '${slug.slug}' already exists` };

  const project: Project = {
    id: randomUUID(),
    slug: slug.slug,
    display_name: input.display_name.trim(),
    created_at: new Date().toISOString(),
    archived_at: null,
  };

  db.prepare(
    "INSERT INTO projects (id, slug, display_name, created_at, archived_at) VALUES (?, ?, ?, ?, NULL)",
  ).run(project.id, project.slug, project.display_name, project.created_at);

  return { ok: true, project };
}

export function renameProject(slug: string, display_name: string): Project | null {
  const db = getDb();
  const trimmed = display_name.trim();
  if (!trimmed) return null;
  db.prepare("UPDATE projects SET display_name = ? WHERE slug = ?").run(trimmed, slug);
  return getProject(slug);
}

export function archiveProject(slug: string): Project | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE projects SET archived_at = ? WHERE slug = ? AND archived_at IS NULL").run(now, slug);
  return getProject(slug);
}

export function unarchiveProject(slug: string): Project | null {
  const db = getDb();
  db.prepare("UPDATE projects SET archived_at = NULL WHERE slug = ?").run(slug);
  return getProject(slug);
}
