import { NextResponse } from "next/server";
import { getActiveProject } from "@/server/active-project";
import {
  agentNameFor,
  templateForUrlSlug,
  type AgentTemplateKey,
} from "@/server/agent-templates";
import { streamAgentTurn } from "@/server/openclaw/agent-turn";
import { getSessionsView, setActiveSession } from "@/server/openclaw/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatPostBody = {
  message: string;
  agent?: string;
  /** Optional explicit OpenClaw session id (UUID). Defaults to the active one. */
  sessionId?: string;
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
  const template = templateForUrlSlug(requestedSlug);
  if (!template) {
    return NextResponse.json(
      { error: `Unknown agent: '${requestedSlug}'` },
      { status: 404 },
    );
  }

  // Resolve session: explicit body wins, otherwise the active session for
  // (project, agent). If none, getSessionsView mints a fresh UUID and uses it.
  let sessionId = body.sessionId?.trim();
  if (!sessionId) {
    const view = await getSessionsView(project.slug, template.key as AgentTemplateKey);
    sessionId = view.active.sessionId;
  }

  // Persist the active session in the cookie so reloads land back in the same
  // thread without us tracking anything ourselves.
  await setActiveSession(project.slug, template.key as AgentTemplateKey, sessionId);

  const agentName = agentNameFor(project.slug, template.key as AgentTemplateKey);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        send("meta", {
          project_slug: project.slug,
          agent: agentName,
          session_id: sessionId,
        });
        for await (const chunk of streamAgentTurn({
          agent: agentName,
          message: body.message,
          sessionId,
        })) {
          send("text", { chunk });
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
