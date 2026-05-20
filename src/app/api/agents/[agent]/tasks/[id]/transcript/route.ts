import { NextResponse } from "next/server";
import { getActiveProject } from "@/server/active-project";
import { resolveAgentBySlug } from "@/server/agent-meta";
import { getTask } from "@/server/db/tasks";
import { readTranscriptTail } from "@/server/openclaw/transcript-tail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the slice of the on-disk JSONL transcript that lives after the
 * client's last seen byte offset. The client appends `events` to its local
 * buffer and sends the returned `byteOffset` back on the next poll.
 *
 * `done: true` tells the client to stop polling — set when the task has
 * reached a terminal status. A null `byteOffset` means OpenClaw hasn't
 * written a transcript file yet (proposed task whose kickoff hasn't landed).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ agent: string; id: string }> },
) {
  const { agent: agentSlug, id: taskId } = await context.params;

  const project = await getActiveProject();
  if (!project) {
    return NextResponse.json({ error: "no active project" }, { status: 400 });
  }

  const resolved = await resolveAgentBySlug(project.slug, agentSlug);
  if (!resolved) {
    return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  }

  const task = getTask(taskId);
  if (!task || task.project_slug !== project.slug) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  // Cross-agent task access guard — the URL agent must own this task.
  if (task.agent_id !== resolved.agent_id) {
    return NextResponse.json({ error: "task not on this agent" }, { status: 404 });
  }
  if (!task.thread_id) {
    // Thread isn't minted yet (task just created, never opened). Nothing on
    // disk to tail. Client will retry on the next poll tick.
    return NextResponse.json({
      events: [],
      byteOffset: 0,
      file_size: 0,
      done: false,
      status: task.status,
    });
  }

  const url = new URL(request.url);
  const offsetParam = url.searchParams.get("offset");
  const byteOffset = offsetParam ? Number(offsetParam) : 0;
  const validOffset = Number.isFinite(byteOffset) && byteOffset >= 0 ? byteOffset : 0;

  const { events, byteOffset: newOffset, fileSize } = readTranscriptTail(
    resolved.agent_id,
    task.thread_id,
    validOffset,
  );

  const terminal =
    task.status === "succeeded" ||
    task.status === "failed" ||
    task.status === "cancelled";

  return NextResponse.json({
    events,
    byteOffset: newOffset,
    file_size: fileSize,
    // Only stop polling AFTER the task is terminal AND we've drained the
    // file. Otherwise the last few events written between status-flip and
    // our read can get dropped.
    done: terminal && newOffset >= fileSize,
    status: task.status,
  });
}
