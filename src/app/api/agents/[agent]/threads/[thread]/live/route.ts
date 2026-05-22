import { NextResponse } from "next/server";

import { getActiveProject } from "@/server/active-project";
import { resolveAgentBySlug } from "@/server/agent-meta";
import { getProject } from "@/server/db/projects";
import { GatewayClient } from "@/server/openclaw/gateway-client";
import {
  buildPendingSessionKey,
  findSessionBySessionId,
} from "@/server/openclaw/sessions";
import {
  rawEntryToEvents,
  type RawEntry,
} from "@/server/openclaw/transcript-tail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE bridge that re-attaches to an in-progress OpenClaw session and
 * forwards transcript events live. Bypasses the JSONL-flush latency:
 * OpenClaw buffers session.jsonl until session.ended, so polling
 * /api/agents/.../threads/.../transcript sees nothing mid-turn. This
 * endpoint instead subscribes via `sessions.messages.subscribe` over
 * the WS gateway and forwards every `session.message` event as SSE.
 *
 * Used by the LiveTranscript component for in-flight tasks (especially
 * audit tasks that were auto-kicked-off server-side via the
 * blocked-by-task propagation hook — those have no /api/chat SSE
 * channel and would otherwise look "stuck" until JSONL flushes).
 *
 * Lifecycle:
 *   - Resolves agent_full_id from the project's roster.
 *   - Resolves the session key from threadId (the URL "label" segment
 *     of OpenClaw's `agent:<agent>:<label>` keying).
 *   - Opens a fresh GatewayClient (NOT the shared one — re-attach is
 *     long-lived and would block other callers if it shared the
 *     handshake), subscribes, listens, forwards.
 *   - On client disconnect (browser close, navigation): tears down the
 *     subscription and closes the gateway WS so we don't leak.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agent: string; thread: string }> },
): Promise<Response> {
  const { agent: agentSlug, thread: threadId } = await params;

  const url = new URL(request.url);
  const projectSlug = url.searchParams.get("project");
  const projectRow = projectSlug ? getProject(projectSlug) : await getActiveProject();
  if (!projectRow || projectRow.archived_at) {
    return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  }
  const resolved = await resolveAgentBySlug(projectRow.slug, agentSlug);
  if (!resolved) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  }
  const agentFullId = resolved.agent_id;

  // Resolve session key. If OpenClaw doesn't have a session row yet
  // (brand-new thread — first message hasn't been sent), fall back to
  // the pending key shape. Subscribing to a not-yet-existing session is
  // a no-op from the gateway's side; events will start flowing as soon
  // as the session is created.
  const sessionRow = findSessionBySessionId(agentFullId, threadId);
  const sessionKey =
    sessionRow?.sessionKey ?? buildPendingSessionKey(agentFullId, threadId);

  const encoder = new TextEncoder();
  let evtCounter = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let client: GatewayClient | null = null;
      let removeListener: (() => void) | null = null;
      let closed = false;

      function send(event: string, data: unknown): void {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream already torn down; ignore.
        }
      }

      function teardown(): void {
        if (closed) return;
        closed = true;
        removeListener?.();
        // Best-effort unsubscribe; gateway times the subscription out
        // anyway when the WS closes.
        if (client?.isOpen()) {
          void client.request("sessions.messages.unsubscribe", {
            key: sessionKey,
          }).catch(() => {});
        }
        try {
          client?.close();
        } catch {}
        try {
          controller.close();
        } catch {}
      }

      request.signal.addEventListener("abort", teardown);

      try {
        client = new GatewayClient();
        await client.open();
        removeListener = client.addEventListener((evt) => {
          if (evt.event !== "session.message") return;
          const payload = evt.payload as
            | {
                sessionKey?: string;
                message?: unknown;
                messageId?: string;
                messageSeq?: number;
              }
            | undefined;
          if (!payload) return;
          // Filter cross-session noise — subscriptions are scoped but the
          // gateway broadcasts on a shared listener pool.
          if (payload.sessionKey !== sessionKey) return;

          // The `message` payload mirrors the JSONL "message" field; wrap
          // it in a RawEntry so the shared parser produces the same shape
          // the polling path emits. Stable id from messageId/seq keeps
          // the client-side dedup honest (the same event can land via
          // SSE here AND via polling once JSONL flushes).
          const idHint =
            payload.messageId ??
            (typeof payload.messageSeq === "number"
              ? `msg-${payload.messageSeq}`
              : `sse-${evtCounter++}`);
          const raw: RawEntry = {
            type: "message",
            id: idHint,
            message: payload.message as RawEntry["message"],
          };
          const events = rawEntryToEvents(raw, idHint);
          if (events.length === 0) return;
          send("transcript", { events });
        });

        // Subscribe + send a hello so the client knows the bridge is live.
        await client.request("sessions.messages.subscribe", { key: sessionKey });
        send("ready", { sessionKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message });
        teardown();
      }
    },
    cancel() {
      // Browser closed the EventSource — nothing else to do; the abort
      // signal handler already runs teardown.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
