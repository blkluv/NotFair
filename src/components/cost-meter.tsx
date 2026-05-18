import { costToday } from "@/server/db/cost";
import { getGuardrails } from "@/server/db/guardrails";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CostMeterProps = {
  project_slug: string;
};

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function CostMeter({ project_slug }: CostMeterProps) {
  const cost = costToday(project_slug);
  const guardrails = getGuardrails(project_slug);
  const cap = guardrails.max_daily_spend_usd;
  const pct = cap > 0 ? Math.min(100, (cost.total_usd / cap) * 100) : 0;

  const status =
    pct >= 100 ? "halted" : pct >= 90 ? "danger" : pct >= 75 ? "warn" : "ok";

  const barColor = {
    ok: "bg-zinc-400 dark:bg-zinc-500",
    warn: "bg-amber-500",
    danger: "bg-red-500",
    halted: "bg-red-600",
  }[status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="w-full space-y-1.5 px-2 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent/50 rounded-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Today</span>
            <span
              className={cn(
                "tabular-nums font-medium",
                status === "halted" && "text-red-600 dark:text-red-400",
                status === "danger" && "text-red-600 dark:text-red-400",
              )}
            >
              {formatUsd(cost.total_usd)} / {formatUsd(cap)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all", barColor)}
              style={{ width: `${pct}%` }}
              aria-label={`${pct.toFixed(0)}% of daily budget`}
            />
          </div>
          {status === "halted" && (
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
              Daily cap reached
            </p>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="w-56 space-y-1.5">
        <p className="text-xs font-medium">Today&rsquo;s spend</p>
        <div className="space-y-1 text-[11px]">
          <CostRow label="LLM" value={cost.by_source.llm} />
          <CostRow label="Google Ads" value={cost.by_source.google_ads} />
          <CostRow label="GSC" value={cost.by_source.gsc} />
          <CostRow label="Other" value={cost.by_source.other} />
          <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatUsd(cost.total_usd)}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Daily cap</span>
            <span className="tabular-nums">{formatUsd(cap)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatUsd(value)}</span>
    </div>
  );
}
