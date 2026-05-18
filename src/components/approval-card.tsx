"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { approveAction, rejectAction } from "@/server/actions/approvals";
import type { Approval } from "@/types";

const ACTION_TYPE_LABEL: Record<Approval["action_type"], string> = {
  spend: "Spend",
  content_publishing: "Content",
  new_channel: "New channel",
  bid_change: "Bid change",
  audience_change: "Audience",
  other: "Other",
};

function formatUsd(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function ApprovalCard({ approval }: { approval: Approval }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      const r = await approveAction(approval.id);
      if (!r.ok) toast.error(r.error ?? "Failed to approve");
      else toast.success("Approved — running now");
    });
  }
  function reject() {
    start(async () => {
      const r = await rejectAction(approval.id);
      if (!r.ok) toast.error(r.error ?? "Failed to reject");
      else toast.success("Rejected");
    });
  }

  return (
    <Card className="overflow-hidden" role="region" aria-label={approval.action_summary}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Badge variant="outline" className="text-[10px]">
              {ACTION_TYPE_LABEL[approval.action_type]}
            </Badge>
            <p className="text-sm font-medium">{approval.action_summary}</p>
            <p className="text-xs text-muted-foreground">
              {approval.cost_estimate_usd > 0 && (
                <>
                  Cost: <span className="font-medium">{formatUsd(approval.cost_estimate_usd)}</span> ·{" "}
                </>
              )}
              Agent <span className="font-mono">{approval.agent_id}</span> · {timeAgo(approval.created_at)}
            </p>
          </div>
        </div>

        {approval.reasoning && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            Why?
          </button>
        )}
        {expanded && approval.reasoning && (
          <p className="rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {approval.reasoning}
          </p>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={approve} disabled={pending}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={reject} disabled={pending}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
