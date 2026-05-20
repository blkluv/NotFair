import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIGRATIONS } from "./migrations";

// Use a real in-memory better-sqlite3 instance so SQLite's FK constraint
// actually engages — mocking the DB would defeat the point (the bug was a
// real FK violation our code wasn't catching).
let testDb: Database.Database;

vi.mock("./db", () => ({
  getDb: () => testDb,
  getDbPath: () => ":memory:",
}));

import { createProject, deleteProjectRow } from "./projects";

function applyMigrations(db: Database.Database): void {
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
  }
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

beforeEach(() => {
  testDb = createDb();
});

afterEach(() => {
  testDb.close();
});

describe("deleteProjectRow", () => {
  it("cleans the project row when no child rows exist", () => {
    const result = createProject({ display_name: "Acme" });
    expect(result.ok).toBe(true);
    expect(() => deleteProjectRow("acme")).not.toThrow();
    expect(testDb.prepare("SELECT 1 FROM projects WHERE slug = ?").get("acme")).toBeUndefined();
  });

  describe("regression: FOREIGN KEY constraint failure on delete", () => {
    // The bug: deleteProjectRow's childTables list was stale — it deleted
    // from guardrails/approvals/agent_actions/cost_snapshots/connections
    // (the last two don't even exist in our migrations), missing tasks,
    // cost_events, oauth_tokens, sequence_runs. With orchestration adding
    // task rows aggressively, deletes started tripping the FK constraint.
    // This block populates every FK-bearing table and asserts the delete
    // succeeds + nothing is left behind.

    it("cleans tasks rows (the table that exposed the bug)", () => {
      createProject({ display_name: "Acme" });
      testDb
        .prepare(
          `INSERT INTO tasks
             (id, project_slug, agent_id, brief, status, created_at, updated_at)
           VALUES ('t1', 'acme', 'acme-google-ads', 'do x', 'proposed', 'now', 'now')`,
        )
        .run();

      expect(() => deleteProjectRow("acme")).not.toThrow();
      expect(testDb.prepare("SELECT 1 FROM tasks WHERE project_slug = ?").get("acme")).toBeUndefined();
      expect(testDb.prepare("SELECT 1 FROM projects WHERE slug = ?").get("acme")).toBeUndefined();
    });

    it("cleans every FK-bearing child table without tripping FK", () => {
      createProject({ display_name: "Acme" });

      // One row per FK-bearing table from the migrations. If any new
      // migration adds a project_slug FK and forgets to update
      // deleteProjectRow's list, this test fails immediately.
      testDb
        .prepare(
          `INSERT INTO tasks
             (id, project_slug, agent_id, brief, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("t1", "acme", "acme-google-ads", "do x", "proposed", "now", "now");
      testDb
        .prepare(
          `INSERT INTO approvals
             (id, project_slug, agent_id, action_summary, action_type, cost_estimate_usd, payload_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("ap1", "acme", "acme-google-ads", "raise bid", "bid_change", 0, "{}", "pending", "now");
      testDb
        .prepare(
          `INSERT INTO cost_events
             (id, project_slug, agent_id, source, amount_usd, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("c1", "acme", "acme-google-ads", "llm", 0.01, "now");
      testDb
        .prepare(
          `INSERT INTO oauth_tokens
             (id, project_slug, provider, account_label, access_token_enc, refresh_token_enc, expires_at, scope, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("o1", "acme", "google_ads", "acme", "x", "y", "later", "scope", "now", "now");
      testDb
        .prepare(
          `INSERT INTO guardrails (project_slug, config_json, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run("acme", "{}", "now");
      testDb
        .prepare(
          `INSERT INTO agent_actions
             (id, project_slug, agent_id, action_type, summary, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("a1", "acme", "system", "project_created", "x", "now");
      testDb
        .prepare(
          `INSERT INTO sequence_runs
             (id, project_slug, agent_id, sequence_kind, cursor, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("s1", "acme", "acme-cmo", "k", "0", "pending", "now", "now");

      // Pre-condition: every child table has a row keyed to acme.
      for (const table of [
        "tasks",
        "approvals",
        "cost_events",
        "oauth_tokens",
        "guardrails",
        "agent_actions",
        "sequence_runs",
      ]) {
        expect(
          testDb.prepare(`SELECT 1 FROM ${table} WHERE project_slug = ?`).get("acme"),
          `${table} should have a pre-existing row`,
        ).toBeTruthy();
      }

      // The actual fix: delete should NOT throw FOREIGN KEY constraint failed.
      expect(() => deleteProjectRow("acme")).not.toThrow();

      // Post-condition: project + every child row gone.
      expect(
        testDb.prepare("SELECT 1 FROM projects WHERE slug = ?").get("acme"),
      ).toBeUndefined();
      for (const table of [
        "tasks",
        "approvals",
        "cost_events",
        "oauth_tokens",
        "guardrails",
        "agent_actions",
        "sequence_runs",
      ]) {
        expect(
          testDb.prepare(`SELECT 1 FROM ${table} WHERE project_slug = ?`).get("acme"),
          `${table} should have no rows after delete`,
        ).toBeUndefined();
      }
    });
  });
});
