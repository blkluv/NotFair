"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectHref } from "@/lib/project-href";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SessionLite = {
  sessionId: string;
  label: string;
  sessionKey: string;
  lastInteractionAt: number;
  pending: boolean;
};

type Props = {
  projectSlug: string;
  agentSlug: string;
  sessions: SessionLite[];
  activeSessionId: string;
};

function timeAgo(ms: number) {
  if (!ms) return "new";
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function displayTitle(s: SessionLite): string {
  if (s.pending) return `New thread · ${s.sessionId.slice(0, 8)}`;
  if (s.label === "main") return "Main thread";
  return s.label.length > 32 ? `${s.label.slice(0, 32)}...` : s.label;
}

export function ThreadSelector({
  projectSlug,
  agentSlug,
  sessions,
  activeSessionId,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = sessions.find((s) => s.sessionId === activeSessionId);

  function go(sessionId: string) {
    if (sessionId === activeSessionId) return;
    start(() =>
      router.push(projectHref(projectSlug, `/agents/${agentSlug}/chat/${sessionId}`)),
    );
  }

  function newThread() {
    const id = crypto.randomUUID();
    start(() =>
      router.push(projectHref(projectSlug, `/agents/${agentSlug}/chat/${id}`)),
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[200px] justify-between"
          disabled={pending}
        >
          <span className="truncate text-left">
            {active ? displayTitle(active) : "Pick a thread"}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Threads ({sessions.length}) · from OpenClaw
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sessions.length === 0 && (
          <DropdownMenuItem disabled>No threads yet</DropdownMenuItem>
        )}
        {sessions.map((s) => {
          const isActive = s.sessionId === activeSessionId;
          return (
            <DropdownMenuItem
              key={s.sessionId}
              onSelect={(e) => {
                e.preventDefault();
                go(s.sessionId);
              }}
              className="flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{displayTitle(s)}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {s.sessionId.slice(0, 8)} · {timeAgo(s.lastInteractionAt)}
                </div>
              </div>
              {isActive && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            newThread();
          }}
          disabled={pending}
        >
          <Plus className="mr-2 size-3.5" />
          New thread
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
