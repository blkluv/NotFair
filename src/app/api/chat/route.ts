import { NextResponse } from "next/server";
import { getActiveProject } from "@/server/active-project";
import { resolveAgentBySlug } from "@/server/agent-meta";
import { streamChatViaGateway } from "@/server/openclaw/gateway-client";
import {
  buildPendingSessionKey,
  findSessionBySessionId,
} from "@/server/openclaw/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatPostBody = {
  message: string;
  agent?: string;
  /** OpenClaw session UUID — used for trajectory file naming. */
  sessionId?: string;
  /**
   * OpenClaw's canonical `agent:<agent>:<label>` key for this thread. When the
   * client knows the right key (e.g., `agent:foo:main` for an existing thread
   * whose label is not the sessionId), pass it here. Falls back to a
   * sessionId-derived key for brand-new threads.
   */
  sessionKey?: string;
};

export async function POST(request: Request) {
  const project = await getActiveProject();
  if (!project) {
    return NextResponse.json(
      { error: "No active project. Create one first." },
      { status: 400 },
    );
  }

  let body: ChatPostBody;
  try {
    body = (await request.json()) as ChatPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const requestedSlug = (body.agent ?? "cmo").trim();
  const resolved = await resolveAgentBySlug(project.slug, requestedSlug);
  if (!resolved) {
    return NextResponse.json(
      { error: `Unknown agent: '${requestedSlug}'` },
      { status: 404 },
    );
  }

  const agentName = resolved.agent_id;

  // Resolve session: explicit body wins. New pages always pass both sessionId
  // and sessionKey; sessionKey-only callers (legacy or external) get the
  // canonical key looked up below.
  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required (call from a threaded chat URL)." },
      { status: 400 },
    );
  }
  let sessionKey = body.sessionKey?.trim();
  if (!sessionKey) {
    const known = findSessionBySessionId(agentName, sessionId);
    sessionKey = known?.sessionKey ?? buildPendingSessionKey(agentName, sessionId);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const abortCtl = new AbortController();
      request.signal?.addEventListener("abort", () => abortCtl.abort(), { once: true });

      try {
        send("meta", {
          project_slug: project.slug,
          agent: agentName,
          session_id: sessionId,
          session_key: sessionKey,
        });
        for await (const evt of streamChatViaGateway({
          sessionKey,
          sessionId,
          message: body.message,
          signal: abortCtl.signal,
        })) {
          if (evt.kind === "delta") {
            send("text", { chunk: evt.text });
          } else if (evt.kind === "error") {
            send("error", { message: evt.message });
          }
          // "final" implicitly ends the loop after; no separate signal needed.
        }
        send("done", {});
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
