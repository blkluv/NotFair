import {
  buildPendingSessionKey,
} from "@/server/openclaw/sessions";
import { streamChatViaGateway } from "@/server/openclaw/gateway-client";
import { setTaskThreadIfMissing, updateTask } from "@/server/db/tasks";
import type { Task } from "@/types";

import { generateTaskThreadId, processOrchestrationBlocks } from "./process-blocks";
import { buildTaskKickoffMessage } from "./task-kickoff";

/**
 * Idempotent "claim and kickoff" — flips a proposed task to running and
 * fires the server-side kickoff. No-op when the task isn't proposed (already
 * started, already done, etc.). Used by sub-task delegation paths (CMO
 * creates a task for a specialist, no client is watching) and the "Start
 * all" batch button.
 *
 * The kickoff itself runs fire-and-forget — callers shouldn't await it.
 * Since the gateway stream is consumed server-side, the page only sees
 * tokens once OpenClaw flushes the complete assistant message to JSONL
 * (typically when the turn ends). For tasks the user is actively watching
 * in the workspace, prefer `claimTaskIfProposed` and let the client run the
 * kickoff via `/api/chat` so SSE deltas stream live.
 */
export function startTaskIfProposed(task: Task): Task {
  if (task.status !== "proposed") return task;
  const claimed = updateTask(task.id, { status: "running" });
  if (!claimed) return task;
  void runTaskKickoffServerSide(claimed).catch((err) => {
    console.error("[start-task] kickoff failed:", err);
  });
  return claimed;
}

/**
 * Flip a proposed task to running without firing the gateway. Used by the
 * task workspace so opening a proposed task immediately reflects "running"
 * in the UI while the client drives the kickoff itself via `/api/chat` —
 * that path streams the agent's tokens as SSE so the user sees the response
 * forming in real time instead of a wall of text dumping in at the end.
 *
 * Returns the (possibly-claimed) task plus a `justClaimed` flag the page
 * uses to decide whether the client should auto-send the kickoff message.
 */
export function claimTaskIfProposed(task: Task): {
  task: Task;
  justClaimed: boolean;
} {
  if (task.status !== "proposed") return { task, justClaimed: false };
  const claimed = updateTask(task.id, { status: "running" });
  if (!claimed) return { task, justClaimed: false };
  return { task: claimed, justClaimed: true };
}

/**
 * Server-side kickoff for a task. Consumes the full gateway stream (no SSE
 * pipe to a client) and applies orchestration blocks the assignee emits.
 * Used by the "Start all" button on the agent Tasks tab so the agent
 * starts working immediately without the user opening each task's
 * detail page.
 *
 * Returns when the agent has finished its turn AND orchestration blocks
 * have been processed. Errors are logged + the task is marked failed.
 */
export async function runTaskKickoffServerSide(task: Task): Promise<void> {
  // Lazily mint the thread on first kickoff if the task didn't have one
  // (e.g., user never opened /tasks/[id]). Stable forever after.
  let finalTask = task;
  if (!finalTask.thread_id) {
    const updated = setTaskThreadIfMissing(task.id, generateTaskThreadId());
    if (updated) finalTask = updated;
    if (!finalTask.thread_id) {
      throw new Error(`Failed to assign thread_id for task ${task.id}`);
    }
  }

  const sessionKey = buildPendingSessionKey(finalTask.agent_id, finalTask.thread_id);
  const kickoffMessage = buildTaskKickoffMessage(finalTask);

  let buffer = "";
  try {
    for await (const evt of streamChatViaGateway({
      sessionKey,
      sessionId: finalTask.thread_id,
      message: kickoffMessage,
    })) {
      if (evt.kind === "delta") buffer += evt.text;
      if (evt.kind === "error") {
        throw new Error(evt.message);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run-task] kickoff failed for ${finalTask.id}:`, err);
    updateTask(finalTask.id, {
      status: "failed",
      error_message: message,
    });
    return;
  }

  if (buffer.trim().length > 0) {
    try {
      await processOrchestrationBlocks(buffer, {
        project_slug: finalTask.project_slug,
        agent_id: finalTask.agent_id,
      });
    } catch (err) {
      console.error(
        `[run-task] orchestration processing failed for ${finalTask.id}:`,
        err,
      );
    }
  }
}
