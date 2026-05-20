"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  FileText,
  Globe,
  Loader2,
  Send,
  StopCircle,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { RunningDot } from "@/components/running-dot";
import { cn } from "@/lib/utils";
import { stripOrchestrationBlocks } from "@/server/orchestration/blocks";
import type { TranscriptEvent } from "@/server/openclaw/transcript-tail";
import type { TaskStatus } from "@/types";

const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_DURATION_MS = 10 * 60 * 1000;

const IN_FLIGHT_STATUSES: TaskStatus[] = ["proposed", "approved", "running"];

type Props = {
  agentSlug: string;
  agentDisplayName: string;
  taskId: string;
  taskStatus: TaskStatus;
  /** Server-rendered initial slice of the transcript. */
  initialEvents: TranscriptEvent[];
  /** Byte offset *after* `initialEvents` — polls start from here. */
  initialByteOffset: number;
  /** sessionId / sessionKey for the per-task chat thread, used by /api/chat. */
  sessionId: string;
  sessionKey: string;
};

export function LiveTranscript({
  agentSlug,
  agentDisplayName,
  taskId,
  taskStatus,
  initialEvents,
  initialByteOffset,
  sessionId,
  sessionKey,
}: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<TranscriptEvent[]>(initialEvents);
  const [byteOffset, setByteOffset] = useState(initialByteOffset);
  const [status, setStatus] = useState<TaskStatus>(taskStatus);
  const [input, setInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  const startedAtRef = useRef<number | null>(null);

  const isInFlight = IN_FLIGHT_STATUSES.includes(status);

  // ── Auto-scroll: only when the user is already near the bottom. ─────
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickyBottomRef.current = remaining < 96;
  }
  useLayoutEffect(() => {
    if (!stickyBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, sendingChat]);

  // ── Live tail polling. Stops once the server reports `done: true`. ──
  const pollOnce = useCallback(async () => {
    try {
      const url = `/api/agents/${agentSlug}/tasks/${taskId}/transcript?offset=${byteOffset}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return { stop: false };
      const data = (await res.json()) as {
        events: TranscriptEvent[];
        byteOffset: number;
        done: boolean;
        status: TaskStatus;
      };
      if (data.events.length > 0) {
        setEvents((prev) => [...prev, ...data.events]);
      }
      if (data.byteOffset !== byteOffset) setByteOffset(data.byteOffset);
      if (data.status !== status) {
        setStatus(data.status);
        // Status flipped — refresh the rest of the page (task list pills,
        // status badge in the brief header). Cheaper than a full reload.
        router.refresh();
      }
      return { stop: data.done };
    } catch {
      return { stop: false };
    }
  }, [agentSlug, byteOffset, router, status, taskId]);

  useEffect(() => {
    if (!isInFlight) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
      if (elapsed > POLL_MAX_DURATION_MS) return;
      const { stop } = await pollOnce();
      if (cancelled || stop) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isInFlight, pollOnce]);

  // ── Pair tool_call with its eventual tool_result so they render as ONE row.
  const rendered = useMemo(() => collapseToolPairs(events), [events]);

  // ── Composer: enabled only when the task isn't actively in flight. ──
  async function send() {
    const text = input.trim();
    if (!text || sendingChat) return;
    setInput("");
    setSendingChat(true);
    try {
      // Pipe through /api/chat exactly like AgentChat does — the response
      // streams to the JSONL we're already tailing, so the new turn lands
      // automatically once polling resumes (which we kick off below by
      // letting the task status flip back to running via the server).
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          agent: agentSlug,
          sessionId,
          sessionKey,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        throw new Error(err || `HTTP ${res.status}`);
      }
      // Drain the SSE stream so the gateway run completes; we don't need
      // to render its events here (the JSONL tail will pick everything up
      // on the next poll). We just have to consume the body so the agent
      // turn doesn't stall on backpressure.
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      // After the turn closes, prompt a re-poll so the new transcript bytes
      // show up immediately instead of waiting for the next tick.
      void pollOnce();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSendingChat(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {rendered.length === 0 ? (
            <TranscriptEmptyState
              status={status}
              agentDisplayName={agentDisplayName}
            />
          ) : (
            <ol className="space-y-4">
              {rendered.map((item) => (
                <li key={item.key}>
                  <RenderItem
                    item={item}
                    agentDisplayName={agentDisplayName}
                  />
                </li>
              ))}
            </ol>
          )}
          {isInFlight && <ThinkingPulse agentDisplayName={agentDisplayName} />}
          <div ref={bottomSentinelRef} />
        </div>
      </div>

      <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-3xl px-6 py-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={isInFlight || sendingChat}
              placeholder={
                isInFlight
                  ? `${agentDisplayName} is working — the transcript updates live`
                  : `Message ${agentDisplayName}…`
              }
              rows={1}
              className="flex min-h-[40px] flex-1 resize-none rounded-xl border bg-background px-3.5 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              type="submit"
              size="sm"
              disabled={isInFlight || sendingChat || !input.trim()}
              className="h-10 rounded-xl"
            >
              {sendingChat ? (
                <StopCircle className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              <span className="sr-only">Send</span>
            </Button>
          </form>
          <p className="pt-1.5 text-center text-[10px] text-muted-foreground">
            {isInFlight ? (
              <span className="inline-flex items-center gap-1.5">
                <RunningDot size="sm" aria-label="" />
                Live · polling every {Math.round(POLL_INTERVAL_MS / 1000)}s
              </span>
            ) : (
              <>Enter to send · Shift+Enter for newline</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Rendering helpers ──────────────────────────────────────────────────

type RenderedItem =
  | { kind: "user_message"; key: string; body: string }
  | { kind: "assistant_text"; key: string; body: string }
  | {
      kind: "tool";
      key: string;
      name: string;
      label: string | null;
      result: string | null;
      ok: boolean;
      done: boolean;
    }
  | { kind: "system_unknown"; key: string; raw_type: string };

/**
 * The on-disk JSONL writes `toolCall` and `toolResult` as separate parts.
 * Pair them up so the UI shows a single row that flips from spinner to
 * check (mirrors AgentChat's StepList behavior).
 */
function collapseToolPairs(events: TranscriptEvent[]): RenderedItem[] {
  const out: RenderedItem[] = [];
  const callIndex = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool_call") {
      callIndex.set(e.tool_call_id, out.length);
      out.push({
        kind: "tool",
        key: e.id,
        name: e.name,
        label: e.label,
        result: null,
        ok: true,
        done: false,
      });
      continue;
    }
    if (e.kind === "tool_result") {
      const idx = callIndex.get(e.tool_call_id);
      if (idx != null) {
        const prev = out[idx];
        if (prev && prev.kind === "tool") {
          out[idx] = {
            ...prev,
            result: e.summary,
            ok: e.ok,
            done: true,
          };
          continue;
        }
      }
      // Orphan result (no matching call earlier in the buffer) — render
      // standalone so the user still sees something.
      out.push({
        kind: "tool",
        key: e.id,
        name: e.name,
        label: null,
        result: e.summary,
        ok: e.ok,
        done: true,
      });
      continue;
    }
    if (e.kind === "user_message") {
      out.push({ kind: "user_message", key: e.id, body: e.body });
      continue;
    }
    if (e.kind === "assistant_text") {
      out.push({ kind: "assistant_text", key: e.id, body: e.body });
      continue;
    }
    if (e.kind === "unknown") {
      out.push({ kind: "system_unknown", key: e.id, raw_type: e.raw_type });
      continue;
    }
  }
  return out;
}

function RenderItem({
  item,
  agentDisplayName: _agentDisplayName,
}: {
  item: RenderedItem;
  agentDisplayName: string;
}) {
  if (item.kind === "user_message") {
    // Kickoff messages (the task brief + operating protocol that
    // buildTaskKickoffMessage produces, or FIRST_TURN session opens) are
    // technically user-role rows in OpenClaw, but they're system-injected
    // not user-typed. Collapse them so the transcript reads as "agent
    // acknowledged + did the work", not "USER DUMPED 30 LINES OF XML".
    const isKickoff =
      item.body.startsWith("(task assignment)") ||
      item.body.startsWith("(session start)") ||
      item.body.startsWith("TASK_BRIEF") ||
      item.body.startsWith("FIRST_TURN");
    if (isKickoff) {
      return <KickoffBlock body={item.body} />;
    }
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {item.body}
        </div>
      </div>
    );
  }
  if (item.kind === "assistant_text") {
    // Same orchestration-tag stripping the live chat applies — keeps the
    // raw <task_status>…</task_status>, <create_task>…</create_task> XML
    // out of the user-facing transcript. The structured outcome already
    // lives in the task DB row.
    const cleanBody = stripOrchestrationBlocks(item.body);
    if (cleanBody.trim() === "") return null;
    return (
      <div className="text-sm leading-relaxed">
        <Markdown>{cleanBody}</Markdown>
      </div>
    );
  }
  if (item.kind === "tool") {
    return <ToolRow item={item} />;
  }
  // Unknown / system rows render as a thin divider so the eye can scan past.
  return null;
}

function KickoffBlock({ body }: { body: string }) {
  // Show the task brief as a collapsed system block — full text visible but
  // visually demoted so it doesn't dominate the transcript.
  return (
    <details className="group rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground select-none">
        <span aria-hidden>›</span>
        Task brief sent to agent
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
        {body}
      </pre>
    </details>
  );
}

function ToolRow({
  item,
}: {
  item: Extract<RenderedItem, { kind: "tool" }>;
}) {
  const Icon = iconForTool(item.name);
  const StatusIcon = item.done
    ? item.ok
      ? CheckCircle2
      : AlertCircle
    : Loader2;
  const statusClass = item.done
    ? item.ok
      ? "text-emerald-600"
      : "text-destructive"
    : "text-muted-foreground motion-safe:animate-spin";
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <StatusIcon className={cn("size-3.5 shrink-0", statusClass)} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-[11px] font-medium text-foreground">
          {item.name}
        </span>
        {item.label && (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {item.label}
          </span>
        )}
      </div>
      {item.done && item.result && (
        <div className="pl-6 font-mono text-[11px] text-muted-foreground/90">
          <span className="text-[10px] uppercase tracking-[0.18em]">
            {item.ok ? "→ result" : "→ error"}
          </span>{" "}
          <span className="break-words">{item.result}</span>
        </div>
      )}
    </div>
  );
}

function ThinkingPulse({ agentDisplayName }: { agentDisplayName: string }) {
  return (
    <div className="mt-4 flex items-center gap-2 text-xs italic text-muted-foreground">
      <RunningDot size="sm" aria-label="" />
      {agentDisplayName} is working…
    </div>
  );
}

function TranscriptEmptyState({
  status,
  agentDisplayName,
}: {
  status: TaskStatus;
  agentDisplayName: string;
}) {
  if (status === "proposed") {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Waiting for {agentDisplayName} to pick this up. Hit{" "}
        <span className="font-mono text-xs">Start all</span> on the agent tasks
        page, or open this task to kick it off.
      </div>
    );
  }
  return (
    <div className="py-12 text-center text-sm text-muted-foreground">
      No transcript yet. Send a message below to start the conversation.
    </div>
  );
}

function iconForTool(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n === "exec" || n === "shell" || n === "bash" || n.includes("bash"))
    return Terminal;
  if (n === "read" || n === "cat" || n === "open" || n.includes("read"))
    return FileText;
  if (n === "write" || n === "edit" || n === "patch") return Edit3;
  if (n === "fetch" || n.includes("http") || n.includes("web")) return Globe;
  return Wrench;
}
