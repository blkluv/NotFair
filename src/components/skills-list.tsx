"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { SkillEntry } from "@/server/openclaw/gateway-rpc";
import { setSkillEnabledAction } from "@/server/actions/skills";

type FilterKey = "all" | "enabled" | "disabled" | "visible";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  enabled: "Enabled",
  disabled: "Disabled",
  visible: "Visible to model",
};


type Props = {
  skills: SkillEntry[];
  agentSlug: string;
  /**
   * Per-agent skill allowlist sourced from openclaw.json (not the gateway
   * RPC, whose `agentSkillFilter` collapses "empty allowlist" and "no
   * allowlist" to the same response). `undefined` = no allowlist applied
   * (allow all enabled). `[]` = empty allowlist (block all). `[...]` =
   * allow only listed.
   */
  agentAllowlist?: string[];
};

/**
 * Definition used by both the filter and the toggle:
 *   enabled = !skill.disabled
 * `eligible` is computed by OpenClaw from `enabled` + requirement checks (binary
 * present, allowlist passes, etc.). The user can flip `enabled`; they can't flip
 * `eligible`. So our toggle binds to `!disabled`, and we surface ineligibility
 * with a side badge instead of locking the switch.
 */
export function SkillsList({ skills, agentSlug, agentAllowlist }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");

  // Decide per skill whether the allowlist blocks it. The truth source is
  // openclaw.json — we don't trust the RPC's `blockedByAgentFilter` here
  // because it doesn't differentiate "empty allowlist" from "no allowlist."
  const isBlockedByAllowlist = useMemo(() => {
    if (agentAllowlist === undefined) return () => false; // no per-agent filter
    const set = new Set(agentAllowlist);
    return (s: SkillEntry) => !set.has(s.skillKey);
  }, [agentAllowlist]);

  const counts = useMemo(() => {
    let enabled = 0;
    let disabled = 0;
    let visible = 0;
    for (const s of skills) {
      if (s.disabled) disabled++;
      else enabled++;
      if (!s.disabled && !isBlockedByAllowlist(s)) visible++;
    }
    return { all: skills.length, enabled, disabled, visible };
  }, [skills, isBlockedByAllowlist]);

  const filtered = useMemo(() => {
    if (filter === "all") return skills;
    if (filter === "enabled") return skills.filter((s) => !s.disabled);
    if (filter === "visible")
      return skills.filter((s) => !s.disabled && !isBlockedByAllowlist(s));
    return skills.filter((s) => s.disabled);
  }, [skills, filter, isBlockedByAllowlist]);

  return (
    <div className="space-y-4">
      <div
        className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
        role="tablist"
        aria-label="Filter skills"
      >
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTER_LABELS[key]}
              <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
          No skills match this filter.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filtered.map((s) => (
            <SkillRow
              key={s.skillKey}
              skill={s}
              agentSlug={agentSlug}
              blockedByAllowlist={isBlockedByAllowlist(s)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  agentSlug,
  blockedByAllowlist,
}: {
  skill: SkillEntry;
  agentSlug: string;
  blockedByAllowlist: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Optimistic flag so the row reflects the toggle instantly while the server
  // round-trip + revalidation finishes.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const isEnabled = optimistic ?? !skill.disabled;

  function onToggle() {
    const next = !isEnabled;
    setOptimistic(next);
    startTransition(async () => {
      const r = await setSkillEnabledAction(skill.skillKey, next, agentSlug);
      if (!r.ok) {
        setOptimistic(!next); // revert
        toast.error(r.error ?? `Could not ${next ? "enable" : "disable"} ${skill.name}`);
      } else {
        toast.success(`${next ? "Enabled" : "Disabled"} ${skill.name}`);
        // Server revalidation will fold optimistic state back in on next render.
      }
    });
  }

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-opacity",
        !isEnabled && "opacity-70",
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-base">
        {skill.emoji ?? "·"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{skill.name}</span>
          {skill.bundled && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase tracking-wide">
              bundled
            </Badge>
          )}
          {skill.always && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] uppercase tracking-wide">
              always-on
            </Badge>
          )}
          {isEnabled && blockedByAllowlist && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
              title="Workspace-enabled, but this agent's allowlist excludes it — the model does not see this skill."
            >
              excluded for this agent
            </Badge>
          )}
          {isEnabled && !blockedByAllowlist && !skill.eligible && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
              title="Enabled in config, but a requirement is missing (binary, allowlist)."
            >
              needs setup
            </Badge>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{skill.description}</p>
        )}
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
          {skill.source}
        </p>
      </div>

      <div className="shrink-0 self-center">
        <Button
          type="button"
          variant={isEnabled ? "outline" : "default"}
          size="sm"
          onClick={onToggle}
          disabled={pending || skill.always}
          title={skill.always ? "Always-on skill; cannot be disabled." : undefined}
          className="h-7 w-20 text-xs"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isEnabled ? (
            "Enabled"
          ) : (
            "Enable"
          )}
        </Button>
      </div>
    </li>
  );
}
