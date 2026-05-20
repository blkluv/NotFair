import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { logAgentAction } from "@/server/db/agent-actions";
import { getMcpConfig, mcpRpc } from "@/server/mcp/rpc";
import { openclaw } from "@/server/openclaw/cli";
import { storedMcpKey } from "@/server/mcp-catalog";

/**
 * Google Ads onboarding audit.
 *
 * Flow:
 *   1. Read project-scoped MCP credentials via getMcpConfig
 *   2. Call MCP `tools/call runScript` with a fixed GAQL fan-out script
 *      (deterministic, no LLM in critical path per D11)
 *   3. Iterate categories, classify findings, emit per-finding events
 *   4. Persist canonical record to agent_actions (D10 + D12: load-bearing)
 *   5. Best-effort write FIRST_TURN.md for the CMO + memory tag (D7)
 *
 * Events are emitted via an AsyncGenerator. The SSE route (Lane A4) pipes
 * them to the client with small stagger for visual rhythm (D17).
 *
 * Decisions wired in:
 *   - D7  — FIRST_TURN.md sentinel for CMO first-turn greeting
 *   - D10 — agent_actions canonical record; OpenClaw memory derived
 *   - D11 — direct HTTP to MCP runScript via shared rpc helper
 *   - D12 — fail-loud on SQLite write; best-effort on memory/file
 *   - D17 — backend constructs the stream; MCP returns bulk
 *   - D5  — empty-account branch when no campaigns or near-zero spend
 */

export type FindingCategory =
  | "WASTED_SPEND"
  | "LOW_QS"
  | "SEARCH_TERM_GAP"
  | "BUDGET_PACING"
  | "ACCOUNT_SNAPSHOT"
  | "NEXT_STEPS";

/**
 * Category-display order and Top Fix tie-break order.
 *
 * ACCOUNT_SNAPSHOT is informational — it always fires when the account has
 * any spend and gives the user proof-of-work ("the audit looked at real
 * data"). NEXT_STEPS is the agency-playbook category: for any non-empty
 * account, it surfaces 1-3 archetype-tailored recommendations with explicit
 * cron cadences (daily/weekly/monthly) the CMO can then propose in chat via
 * the existing propose_cron pattern (D8).
 *
 * Listed LAST so actionable categories render above them in the UI.
 */
const CATEGORY_PRIORITY: FindingCategory[] = [
  "WASTED_SPEND",
  "LOW_QS",
  "SEARCH_TERM_GAP",
  "BUDGET_PACING",
  "ACCOUNT_SNAPSHOT",
  "NEXT_STEPS",
];

/** Categories eligible to be promoted to "Top Fix" (must be actionable). */
const TOP_FIX_ELIGIBLE: ReadonlySet<FindingCategory> = new Set([
  "WASTED_SPEND",
  "LOW_QS",
  "SEARCH_TERM_GAP",
  "BUDGET_PACING",
]);

/**
 * Map each FindingCategory to the GAQL query name in AUDIT_SCRIPT that it
 * transforms. Most are 1:1 (lowercased category = query name). The
 * snapshot + playbook categories both aggregate over campaigns_summary.
 */
const SOURCE_REPORT_FOR: Record<FindingCategory, string> = {
  WASTED_SPEND: "wasted_spend",
  LOW_QS: "low_qs",
  SEARCH_TERM_GAP: "search_term_gap",
  BUDGET_PACING: "budget_pacing",
  ACCOUNT_SNAPSHOT: "campaigns_summary",
  NEXT_STEPS: "campaigns_summary",
};

export type Finding = {
  id: string;
  category: FindingCategory;
  headline: string;
  evidence: string;
  suggested_action: string;
  /** Estimated dollar impact per month — used for Top Fix promotion. */
  dollar_impact_usd: number;
};

export type AccountState = "normal" | "empty";

export type AuditSummary = {
  count: number;
  account_state: AccountState;
  top_fix_id: string | null;
  category_errors: Array<{ category: string; message: string }>;
};

export type AuditEvent =
  | { type: "audit:start" }
  | { type: "audit:finding"; finding: Finding }
  | { type: "audit:finding-error"; category: string; message: string }
  | { type: "audit:empty" }
  | { type: "audit:complete"; summary: AuditSummary }
  | {
      type: "audit:error";
      kind: "mcp_not_configured" | "stale_token" | "unreachable" | "rpc_error" | "malformed_response" | "timeout" | "aborted";
      message: string;
    }
  | { type: "audit:persist-failed"; message: string };

const MCP_CATALOG_KEY = "notfair-googleads";
const MCP_TIMEOUT_MS = 30_000;

/**
 * GAQL fan-out script. Runs ~5 SELECT queries in parallel inside the MCP's
 * QuickJS sandbox via `ads.gaqlParallel`. Returns one object keyed by query
 * name. All queries have LIMIT 50–100 to bound response size on large
 * advertiser accounts (per §2 GAP 2.4). Scoped to LAST_30_DAYS for recency.
 *
 * Iterate on the SQL strings as you observe real accounts — the orchestration
 * code in this file only cares about the response shape, not the WHERE
 * clauses.
 */
const AUDIT_SCRIPT = `
return await ads.gaqlParallel([
  {
    name: "wasted_spend",
    query: \`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group.name,
        campaign.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks
      FROM keyword_view
      WHERE segments.date DURING LAST_30_DAYS
        AND metrics.cost_micros > 100000
        AND metrics.conversions = 0
        AND ad_group_criterion.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    \`,
  },
  {
    name: "low_qs",
    query: \`
      SELECT
        ad_group_criterion.keyword.text,
        ad_group.name,
        campaign.name,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions,
        metrics.cost_micros
      FROM keyword_view
      WHERE ad_group_criterion.quality_info.quality_score < 5
        AND ad_group_criterion.quality_info.quality_score > 0
        AND segments.date DURING LAST_30_DAYS
        AND metrics.impressions > 100
      ORDER BY metrics.impressions DESC
      LIMIT 50
    \`,
  },
  {
    name: "search_term_gap",
    query: \`
      SELECT
        search_term_view.search_term,
        metrics.conversions,
        metrics.cost_micros,
        campaign.name,
        search_term_view.status
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
        AND metrics.conversions > 0
        AND search_term_view.status = 'NONE'
      ORDER BY metrics.conversions DESC
      LIMIT 50
    \`,
  },
  {
    name: "budget_pacing",
    query: \`
      SELECT
        campaign.name,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions
      FROM campaign
      WHERE segments.date DURING YESTERDAY
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    \`,
  },
  {
    name: "campaigns_summary",
    query: \`
      SELECT
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.impressions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      LIMIT 100
    \`,
  },
], { partial: true });
`;

type GaqlRow = Record<string, unknown>;
type GaqlReport = { rows?: GaqlRow[]; error?: string };
type ScriptResult = Record<string, GaqlReport | { error: string }>;

/**
 * The MCP runScript tool wraps the script's return value in this envelope.
 * Real shape observed against notfair.co/api/mcp/google_ads:
 *   { ok: true, result: { <name>: GaqlReport }, resultTruncated, logs,
 *     logsTruncated, timedOut, elapsedMs }
 * Our script returns the `ads.gaqlParallel([...])` result; the MCP server
 * wraps it. We must unwrap `result` before treating it as the category dict.
 */
type RunScriptEnvelope = {
  ok?: boolean;
  result?: ScriptResult;
  resultTruncated?: boolean;
  timedOut?: boolean;
  error?: { message?: string };
};

type McpToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

export type RunAuditOptions = {
  /**
   * The Google Ads customer ID to audit. When omitted, MCP picks the bearer's
   * default account — fine for single-account bearers but the multi-account
   * Demo2 case made this misleading. The onboarding flow now stores the
   * user's selection on projects.google_ads_account_id and passes it here.
   */
  accountId?: string | null;
};

/**
 * Run the audit and yield events. Caller is responsible for piping events
 * to whichever surface the user is watching (SSE, log, etc).
 */
export async function* runAudit(
  project_slug: string,
  signal?: AbortSignal,
  options: RunAuditOptions = {},
): AsyncGenerator<AuditEvent, void, void> {
  yield { type: "audit:start" };

  const cfg = await getMcpConfig(storedMcpKey(project_slug, MCP_CATALOG_KEY));
  if (!cfg) {
    yield {
      type: "audit:error",
      kind: "mcp_not_configured",
      message: "Google Ads MCP is not configured for this project.",
    };
    return;
  }

  const runScriptArgs: Record<string, unknown> = {
    code: AUDIT_SCRIPT,
    timeoutMs: 45_000,
  };
  if (options.accountId) {
    runScriptArgs.accountId = options.accountId;
  }

  const rpcResult = await mcpRpc<McpToolCallResult>(
    cfg.url,
    cfg.token,
    "tools/call",
    { name: "runScript", arguments: runScriptArgs },
    { timeoutMs: MCP_TIMEOUT_MS, signal },
  );

  if (!rpcResult.ok) {
    yield mapRpcError(rpcResult);
    return;
  }

  const reports = parseScriptResult(rpcResult.result);
  if (!reports) {
    yield {
      type: "audit:error",
      kind: "malformed_response",
      message: "MCP runScript returned an unexpected payload shape.",
    };
    return;
  }

  const findings: Finding[] = [];
  const categoryErrors: Array<{ category: string; message: string }> = [];

  for (const category of CATEGORY_PRIORITY) {
    const reportKey = SOURCE_REPORT_FOR[category];
    const report = reports[reportKey];
    if (!report) continue;
    if ("error" in report && report.error) {
      // ACCOUNT_SNAPSHOT sourcing from campaigns_summary inherits its error;
      // surface it under the snapshot category so the user sees the failure
      // in context.
      yield {
        type: "audit:finding-error",
        category,
        message: report.error,
      };
      categoryErrors.push({ category, message: report.error });
      continue;
    }
    const rows = (report as GaqlReport).rows ?? [];
    const transformed = TRANSFORMERS[category](rows);
    for (const f of transformed) {
      findings.push(f);
      yield { type: "audit:finding", finding: f };
    }
  }

  const accountState = classifyAccountState(reports, findings);
  if (accountState === "empty") {
    yield { type: "audit:empty" };
  }

  const topFix = pickTopFix(findings);
  const summary: AuditSummary = {
    count: findings.length,
    account_state: accountState,
    top_fix_id: topFix?.id ?? null,
    category_errors: categoryErrors,
  };

  // D12: agent_actions write is load-bearing. If it throws, fail loud.
  try {
    logAgentAction({
      project_slug,
      agent_id: `${project_slug}-google-ads`,
      action_type: "audit_completed",
      summary: buildSummaryLine(findings, accountState, topFix),
      reasoning: buildReasoningLine(summary),
      payload: { findings, summary, category_errors: categoryErrors },
    });
  } catch (err) {
    yield {
      type: "audit:persist-failed",
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  // D7: FIRST_TURN.md + OpenClaw memory writes are best-effort projections.
  // Failure must NOT block the completion event — the canonical record is
  // already in agent_actions.
  await safeWriteFirstTurn(project_slug, findings, topFix, accountState);
  await safeWriteMemoryTag(project_slug, summary);

  yield { type: "audit:complete", summary };
}

function mapRpcError(
  r: Extract<Awaited<ReturnType<typeof mcpRpc>>, { ok: false }>,
): AuditEvent {
  if (r.kind === "http_error" && (r.status === 401 || r.status === 403)) {
    return {
      type: "audit:error",
      kind: "stale_token",
      message: `Google Ads token rejected (HTTP ${r.status}).`,
    };
  }
  if (r.kind === "http_error") {
    return {
      type: "audit:error",
      kind: "unreachable",
      message: `MCP returned HTTP ${r.status}.`,
    };
  }
  if (r.kind === "timeout") {
    return { type: "audit:error", kind: "timeout", message: "MCP call timed out." };
  }
  if (r.kind === "aborted") {
    return { type: "audit:error", kind: "aborted", message: "Audit cancelled." };
  }
  if (r.kind === "rpc_error") {
    return {
      type: "audit:error",
      kind: "rpc_error",
      message: `RPC error ${r.code}: ${r.message}`,
    };
  }
  if (r.kind === "malformed_response") {
    return {
      type: "audit:error",
      kind: "malformed_response",
      message: r.message,
    };
  }
  return {
    type: "audit:error",
    kind: "unreachable",
    message: r.message,
  };
}

/**
 * MCP wraps the runScript return value in `{content: [{type: 'text', text: <JSON>}], isError}`.
 * Inside that, the script's return value is itself wrapped by the runScript
 * tool in `{ ok, result, resultTruncated, ... }` (verified live against
 * notfair.co/api/mcp/google_ads). We unwrap both layers and return just the
 * category dict (`result`). Returns null when any layer is missing or shaped
 * unexpectedly (treat as malformed_response upstream).
 */
function parseScriptResult(payload: McpToolCallResult): ScriptResult | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.isError) return null;
  const content = payload.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const text = content[0]?.text;
  if (typeof text !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as RunScriptEnvelope & ScriptResult;
  // Preferred path: the runScript envelope with `result`.
  if (envelope.ok === true && envelope.result && typeof envelope.result === "object") {
    return envelope.result;
  }
  // Tool-side script error — surface as malformed_response so the caller
  // emits a clear audit:error event rather than silently classifying empty.
  if (envelope.ok === false) return null;
  // Tolerate older or alternate shapes where the script returned the dict
  // directly. Safe because the runScript envelope always carries `ok`; if
  // it's absent we assume the body IS the category dict.
  return envelope as ScriptResult;
}

function classifyAccountState(
  reports: ScriptResult,
  findings: Finding[],
): AccountState {
  const summary = reports.campaigns_summary;
  if (!summary || "error" in summary) {
    // No summary data — fall back to findings count.
    return findings.length === 0 ? "empty" : "normal";
  }
  const rows = (summary as GaqlReport).rows ?? [];
  if (rows.length === 0) return "empty";
  const last30Spend = rows.reduce(
    (acc, r) => acc + microsAsDollars(getMetric(r, "metrics.cost_micros")),
    0,
  );
  if (last30Spend < 10) return "empty";
  if (!rows.some(isEnabledCampaign)) return "empty";
  return "normal";
}

/**
 * Google Ads returns campaign.status as BOTH a numeric protobuf enum and a
 * string-named convenience field. The numeric value of ENABLED is 2; the
 * gaqlParallel result includes a `status_name: "ENABLED"` companion field.
 * We accept either shape so behavior survives MCP/library upgrades that
 * tighten or loosen the response. Numeric enum reference:
 *   UNSPECIFIED=0, UNKNOWN=1, ENABLED=2, PAUSED=3, REMOVED=4
 */
const CAMPAIGN_STATUS_ENABLED_ENUM = 2;
function isEnabledCampaign(row: GaqlRow): boolean {
  const nameStr = getString(row, "campaign.status_name");
  if (nameStr === "ENABLED") return true;
  const numeric = getMetric(row, "campaign.status");
  if (numeric === CAMPAIGN_STATUS_ENABLED_ENUM) return true;
  const statusStr = getString(row, "campaign.status");
  if (statusStr === "ENABLED") return true;
  return false;
}

/**
 * Top Fix = highest dollar_impact_usd among actionable findings (snapshot
 * categories are skipped). Tie-break by CATEGORY_PRIORITY order. Returns
 * null when only informational findings exist.
 */
function pickTopFix(findings: Finding[]): Finding | null {
  const actionable = findings.filter((f) => TOP_FIX_ELIGIBLE.has(f.category));
  if (actionable.length === 0) return null;
  return actionable.slice().sort((a, b) => {
    if (a.dollar_impact_usd !== b.dollar_impact_usd) {
      return b.dollar_impact_usd - a.dollar_impact_usd;
    }
    return (
      CATEGORY_PRIORITY.indexOf(a.category) -
      CATEGORY_PRIORITY.indexOf(b.category)
    );
  })[0]!;
}

/**
 * Account archetypes for the NEXT_STEPS playbook. Pure rule-based classifier
 * — what a real agency would say after 30 seconds of looking at this account.
 *
 *   empty       — 0 enabled campaigns or campaigns_summary empty
 *   no_tracking — has impressions + spend but 0 conversions in 30d
 *                 (most common new-advertiser failure mode)
 *   low_volume  — has conversions but < 1000 impressions/mo
 *                 (not enough signal to optimize yet)
 *   active      — sustained activity, conversions, real volume
 */
type AccountArchetype = "empty" | "no_tracking" | "low_volume" | "active";

function classifyArchetype(rows: GaqlRow[]): AccountArchetype {
  const enabled = rows.filter(isEnabledCampaign);
  if (enabled.length === 0) return "empty";
  const totalConversions = rows.reduce(
    (acc, r) => acc + (getMetric(r, "metrics.conversions") ?? 0),
    0,
  );
  const totalImpressions = rows.reduce(
    (acc, r) => acc + (getMetric(r, "metrics.impressions") ?? 0),
    0,
  );
  if (totalConversions === 0 && totalImpressions > 0) return "no_tracking";
  if (totalImpressions < 1000) return "low_volume";
  return "active";
}

/**
 * Agency-style playbook per archetype. Each entry is a single Finding the
 * UI renders as a card and the CMO chat picks up from FIRST_TURN.md. The
 * `suggested_action` includes the explicit cron cadence — daily/weekly/
 * monthly — so the CMO can propose it via the propose_cron pattern (D8).
 *
 * Source: distilled from common agency onboarding playbooks (e.g., Google
 * Ads Editor onboarding flows, Optmyzr account audits, Wordstream
 * "First 90 days" checklist). Conservative defaults — won't suggest
 * anything an agency wouldn't.
 */
const NEXT_STEPS_PLAYBOOK: Record<AccountArchetype, Finding[]> = {
  empty: [
    // Empty accounts use the D26 roadmap card in the UI; NEXT_STEPS adds
    // ongoing-ops context for when the user does start campaigns.
    {
      id: "next:setup_conv_tracking",
      category: "NEXT_STEPS",
      headline: "Install conversion tracking before your first $10 of spend.",
      evidence:
        "No campaigns running yet — installing tracking now means your first dollar generates optimization signal.",
      suggested_action:
        "Add the Google Ads conversion tag (or GA4 events) on your site. Once installed, I can run a daily 'is tracking firing?' health check at 9am.",
      dollar_impact_usd: 0,
    },
  ],
  no_tracking: [
    {
      id: "next:install_conv_tracking",
      category: "NEXT_STEPS",
      headline: "Install conversion tracking — 0 conversions on real spend.",
      evidence:
        "Your account is running ads and getting impressions, but no conversions are recorded. Without tracking, optimization is blind.",
      suggested_action:
        "Add the Google Ads conversion tag (or import GA4 events). I can schedule a daily 9am check that alerts you if conv tracking goes silent again.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:weekly_search_term_review",
      category: "NEXT_STEPS",
      headline: "Set up a weekly search-term review.",
      evidence:
        "New accounts collect broad-match noise fast — by week 2 you usually have 5-15 negative-keyword candidates.",
      suggested_action:
        "Schedule a Monday 9am cron: pull last week's search terms with cost > $0 and 0 conversions; surface as a one-click negative-keyword list.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:daily_anomaly",
      category: "NEXT_STEPS",
      headline: "Daily spend anomaly check.",
      evidence:
        "Small accounts can hit budget mid-morning if a competitor bids up an auction. Catching it day-of beats finding out Monday.",
      suggested_action:
        "Schedule a daily 9am cron: alert if yesterday's spend > 2× trailing-7-day average, or if a campaign hit its daily cap before noon.",
      dollar_impact_usd: 0,
    },
  ],
  low_volume: [
    {
      id: "next:raise_bids_or_budget",
      category: "NEXT_STEPS",
      headline:
        "Bid or budget may be too low — under 1,000 impressions/month is not enough to optimize.",
      evidence:
        "Optimization algorithms need ~30 conversions/month to learn. Increase bids on the top 3 keywords or raise the daily budget for 1-2 weeks to gather signal.",
      suggested_action:
        "Want me to pull bid simulator data for your top 3 keywords + recommend an adjustment? Then a weekly Friday 9am pacing check.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:weekly_search_term_review",
      category: "NEXT_STEPS",
      headline: "Set up a weekly search-term review.",
      evidence:
        "Even low-volume accounts benefit from cleaning broad-match noise early — sets the foundation for when you scale.",
      suggested_action:
        "Schedule a Monday 9am cron: pull last week's search terms with cost > $0 and 0 conversions.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:daily_anomaly",
      category: "NEXT_STEPS",
      headline: "Daily spend anomaly check.",
      evidence:
        "Even quiet accounts get budget spikes from auction-time changes.",
      suggested_action:
        "Schedule a daily 9am cron: alert if yesterday's spend > 2× the trailing 7-day average.",
      dollar_impact_usd: 0,
    },
  ],
  active: [
    {
      id: "next:daily_wasted_spend",
      category: "NEXT_STEPS",
      headline: "Daily wasted-spend monitor.",
      evidence:
        "Active accounts accumulate $5-50/day of wasted spend on keywords that stop converting. Daily catch beats weekly cleanup.",
      suggested_action:
        "Schedule a daily 9am cron: surface keywords with > $5 yesterday spend and 0 conversions in the last 7 days for one-click pause.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:weekly_bid_optimization",
      category: "NEXT_STEPS",
      headline: "Weekly bid-optimization pass.",
      evidence:
        "Small adjustments compound — agencies typically see 8-15% CPA improvement from disciplined weekly bid management.",
      suggested_action:
        "Schedule a Monday 9am cron: review top 20 keywords by spend; suggest bid adjustments based on last 14 days of conversion data.",
      dollar_impact_usd: 0,
    },
    {
      id: "next:monthly_structure_review",
      category: "NEXT_STEPS",
      headline: "Monthly campaign-structure review.",
      evidence:
        "Account drift is real — after 90 days, most accounts benefit from re-segmenting ad groups by search intent.",
      suggested_action:
        "Schedule a first-Monday-of-the-month cron: review ad group structure + propose 1-2 refactor opportunities.",
      dollar_impact_usd: 0,
    },
  ],
};

const TRANSFORMERS: Record<FindingCategory, (rows: GaqlRow[]) => Finding[]> = {
  NEXT_STEPS: (rows) => {
    // Always fire — even empty accounts get the "install tracking first"
    // recommendation. The classifier maps account state to a 1-3 finding
    // playbook; the UI renders them as cards under the NEXT_STEPS label.
    const archetype = classifyArchetype(rows);
    return NEXT_STEPS_PLAYBOOK[archetype];
  },
  ACCOUNT_SNAPSHOT: (rows) => {
    if (rows.length === 0) return [];
    // Aggregate across all rows the campaigns_summary returned.
    const totalSpend = rows.reduce(
      (acc, r) => acc + microsAsDollars(getMetric(r, "metrics.cost_micros")),
      0,
    );
    const totalImpressions = rows.reduce(
      (acc, r) => acc + (getMetric(r, "metrics.impressions") ?? 0),
      0,
    );
    const totalConversions = rows.reduce(
      (acc, r) => acc + (getMetric(r, "metrics.conversions") ?? 0),
      0,
    );
    const enabled = rows.filter(isEnabledCampaign);
    const enabledCount = enabled.length;
    const totalCount = rows.length;
    const topCampaign = rows
      .slice()
      .sort(
        (a, b) =>
          (getMetric(b, "metrics.cost_micros") ?? 0) -
          (getMetric(a, "metrics.cost_micros") ?? 0),
      )[0];
    const topName = topCampaign
      ? (getString(topCampaign, "campaign.name") ?? "your top campaign")
      : "your top campaign";

    const headline =
      enabledCount === 1
        ? `${topName}: $${totalSpend.toFixed(2)} spent in the last 30 days`
        : `${enabledCount} active campaign${enabledCount === 1 ? "" : "s"} spent $${totalSpend.toFixed(2)} in the last 30 days`;

    const evidenceParts = [
      `${totalImpressions.toLocaleString()} impressions`,
      `${totalConversions.toFixed(0)} conversion${totalConversions === 1 ? "" : "s"}`,
      `${enabledCount}/${totalCount} campaign${totalCount === 1 ? "" : "s"} enabled`,
    ];

    // Suggested action varies by what we see — never just "looks fine."
    let suggested: string;
    if (totalConversions === 0 && totalImpressions > 0) {
      suggested =
        "0 conversions in 30 days — install conversion tracking or revisit your offer/landing page.";
    } else if (totalImpressions < 100) {
      suggested =
        "Very low impressions — your bids or budget may be capping reach. Want me to check?";
    } else if (totalConversions > 0 && totalSpend / totalConversions > 100) {
      suggested = `High CPA at $${(totalSpend / totalConversions).toFixed(2)} per conversion — let me look at where the spend is going.`;
    } else {
      suggested = "Want me to look for ways to scale this campaign?";
    }

    return [
      {
        id: "account_snapshot",
        category: "ACCOUNT_SNAPSHOT",
        headline,
        evidence: evidenceParts.join(" · "),
        suggested_action: suggested,
        dollar_impact_usd: 0,
      },
    ];
  },
  WASTED_SPEND: (rows) => {
    if (rows.length === 0) return [];
    // Group by campaign — one finding per campaign with multiple wasted kws.
    const byCampaign = new Map<string, GaqlRow[]>();
    for (const r of rows) {
      const cn = getString(r, "campaign.name") ?? "(unknown)";
      const arr = byCampaign.get(cn) ?? [];
      arr.push(r);
      byCampaign.set(cn, arr);
    }
    // Pick the campaign with the biggest wasted spend total — one finding.
    let top: { campaign: string; rows: GaqlRow[]; spend: number } | null = null;
    for (const [campaign, group] of byCampaign) {
      const spend = group.reduce(
        (acc, r) => acc + microsAsDollars(getMetric(r, "metrics.cost_micros")),
        0,
      );
      if (!top || spend > top.spend) top = { campaign, rows: group, spend };
    }
    if (!top) return [];
    const dailyBurn = top.spend / 30;
    const monthlyBurn = top.spend;
    const clicks = top.rows.reduce(
      (acc, r) => acc + (getMetric(r, "metrics.clicks") ?? 0),
      0,
    );
    return [
      {
        id: `wasted_spend:${slugifyForId(top.campaign)}`,
        category: "WASTED_SPEND",
        headline: `${top.campaign} is burning $${dailyBurn.toFixed(0)}/day on ${top.rows.length} zero-conv keyword${top.rows.length === 1 ? "" : "s"}`,
        evidence: `Last 30 days · ${clicks.toLocaleString()} clicks · $${top.spend.toFixed(0)} spent · 0 conv`,
        suggested_action: `Pause those ${top.rows.length} keywords; expected savings $${monthlyBurn.toFixed(0)}/mo`,
        dollar_impact_usd: monthlyBurn,
      },
    ];
  },
  LOW_QS: (rows) => {
    if (rows.length === 0) return [];
    const count = rows.length;
    const impressions = rows.reduce(
      (acc, r) => acc + (getMetric(r, "metrics.impressions") ?? 0),
      0,
    );
    const monthlySpend = rows.reduce(
      (acc, r) => acc + microsAsDollars(getMetric(r, "metrics.cost_micros")),
      0,
    );
    // Low QS roughly costs 20% extra in CPC — back-of-envelope impact.
    const impact = monthlySpend * 0.2;
    return [
      {
        id: "low_qs",
        category: "LOW_QS",
        headline: `${count} keyword${count === 1 ? "" : "s"} below Quality Score 5 — check ad relevance`,
        evidence: `${impressions.toLocaleString()} impressions, ~$${monthlySpend.toFixed(0)}/mo spend with QS penalty`,
        suggested_action: `Tighten ad copy + landing page match; ~$${impact.toFixed(0)}/mo recoverable`,
        dollar_impact_usd: impact,
      },
    ];
  },
  SEARCH_TERM_GAP: (rows) => {
    if (rows.length === 0) return [];
    const count = rows.length;
    const conversions = rows.reduce(
      (acc, r) => acc + (getMetric(r, "metrics.conversions") ?? 0),
      0,
    );
    const spend = rows.reduce(
      (acc, r) => acc + microsAsDollars(getMetric(r, "metrics.cost_micros")),
      0,
    );
    // Adding converting terms as keywords typically improves CPA 10-25%.
    const impact = spend * 0.15;
    return [
      {
        id: "search_term_gap",
        category: "SEARCH_TERM_GAP",
        headline: `${count} converting search term${count === 1 ? "" : "s"} not in your keyword list`,
        evidence: `${conversions.toFixed(0)} conversions from $${spend.toFixed(0)} spend in 30d on unmatched terms`,
        suggested_action: `Add as exact-match keywords; ~$${impact.toFixed(0)}/mo CPA upside`,
        dollar_impact_usd: impact,
      },
    ];
  },
  BUDGET_PACING: (rows) => {
    if (rows.length === 0) return [];
    // Filter for campaigns that hit ≥95% of yesterday's budget.
    const capped = rows.filter((r) => {
      const spend = microsAsDollars(getMetric(r, "metrics.cost_micros"));
      const budget = microsAsDollars(getMetric(r, "campaign_budget.amount_micros"));
      return budget > 0 && spend >= budget * 0.95;
    });
    if (capped.length === 0) return [];
    const monthlyImpact = capped.reduce((acc, r) => {
      const budget = microsAsDollars(getMetric(r, "campaign_budget.amount_micros"));
      // Budget-capped campaigns typically lose ~30% of available impressions.
      return acc + budget * 30 * 0.3;
    }, 0);
    return [
      {
        id: "budget_pacing",
        category: "BUDGET_PACING",
        headline: `${capped.length} campaign${capped.length === 1 ? "" : "s"} hit daily cap yesterday`,
        evidence: `Budget-capped at ≥95% by end of day — missed impressions`,
        suggested_action: `Raise daily cap or shift budget across campaigns; ~$${monthlyImpact.toFixed(0)}/mo recoverable reach`,
        dollar_impact_usd: monthlyImpact,
      },
    ];
  },
};

function buildSummaryLine(
  findings: Finding[],
  state: AccountState,
  topFix: Finding | null,
): string {
  if (state === "empty") return "Audit complete — account is empty or just getting started.";
  if (topFix) {
    return `Audit complete — ${findings.length} finding${findings.length === 1 ? "" : "s"}. Top: ${topFix.headline}`;
  }
  return `Audit complete — ${findings.length} findings.`;
}

function buildReasoningLine(summary: AuditSummary): string {
  const parts = [
    `${summary.count} actionable findings`,
    `account_state=${summary.account_state}`,
  ];
  if (summary.category_errors.length > 0) {
    parts.push(
      `${summary.category_errors.length} category error${summary.category_errors.length === 1 ? "" : "s"}`,
    );
  }
  return parts.join("; ");
}

/**
 * Drop FIRST_TURN.md in the CMO's workspace per D19. Best-effort: never throw.
 * The contract is the markdown shape in the CEO plan's D19 section.
 */
async function safeWriteFirstTurn(
  project_slug: string,
  findings: Finding[],
  topFix: Finding | null,
  accountState: AccountState,
): Promise<void> {
  try {
    const dataDir = process.env.NOTFAIR_CMO_DATA_DIR ?? join(homedir(), ".notfair-cmo");
    const cmoWorkspace = join(dataDir, "agents", `${project_slug}-cmo`);
    await mkdir(cmoWorkspace, { recursive: true });
    const body = renderFirstTurn(project_slug, findings, topFix, accountState);
    await writeFile(join(cmoWorkspace, "FIRST_TURN.md"), body, "utf8");
  } catch (err) {
    console.warn(`FIRST_TURN.md write failed for ${project_slug}:`, err);
  }
}

function renderFirstTurn(
  project_slug: string,
  findings: Finding[],
  topFix: Finding | null,
  accountState: AccountState,
): string {
  const ts = new Date().toISOString();
  const snapshot = findings.find((f) => f.category === "ACCOUNT_SNAPSHOT");
  const nextSteps = findings.filter((f) => f.category === "NEXT_STEPS");
  const actionable = findings.filter(
    (f) => f.category !== "ACCOUNT_SNAPSHOT" && f.category !== "NEXT_STEPS",
  );

  const lines: string[] = [
    "# First-turn context for the CMO",
    "",
    "You have just connected the user's Google Ads account and run a baseline audit.",
    "This is a one-shot context: on your FIRST chat turn after the user opens this",
    "project's CMO chat, weave the highlights into your greeting, then move this",
    "file to MEMORY/last-first-turn-<YYYY-MM-DD>.md so you don't repeat it.",
    "",
    "## Audit metadata",
    `- Project: ${project_slug}`,
    `- Audit run at: ${ts}`,
    `- Account state: ${accountState}`,
    `- Findings count: ${findings.length}`,
    "",
  ];

  if (snapshot) {
    lines.push(
      "## Account snapshot",
      `- ${snapshot.headline}`,
      `- ${snapshot.evidence}`,
      "",
    );
  }

  if (accountState === "empty") {
    lines.push(
      "## Top suggestion (new account — empty audit)",
      `- Set a daily budget for your first campaign — most B2B starts at $50-100/day to gather signal.`,
      "",
      "## Other roadmap items",
      `- Decide your first goal: leads vs traffic vs brand. I can help you pick.`,
      `- Talk it through with me — 30 minutes and you'll have a campaign brief.`,
      "",
    );
  } else if (topFix) {
    const others = actionable.filter((f) => f.id !== topFix.id);
    lines.push(
      "## Top finding (actionable)",
      `- Category: ${topFix.category}`,
      `- Headline: ${topFix.headline}`,
      `- Evidence: ${topFix.evidence}`,
      `- Suggested action: ${topFix.suggested_action}`,
      "",
    );
    if (others.length > 0) {
      lines.push("## Other actionable findings");
      for (const f of others) {
        lines.push(`- ${f.category} — ${f.headline}`);
      }
      lines.push("");
    }
  }

  if (nextSteps.length > 0) {
    lines.push(
      "## Recommended ongoing work (think like an agency)",
      "These are the daily / weekly / monthly tasks a Google Ads agency would",
      "schedule for an account in this state. Propose them in chat via the",
      "<propose_cron> pattern after the user accepts the first one-time action —",
      "each suggested_action below names the cadence to schedule.",
      "",
    );
    for (const f of nextSteps) {
      lines.push(
        `- **${f.headline}**`,
        `  Why: ${f.evidence}`,
        `  Do: ${f.suggested_action}`,
        "",
      );
    }
  }

  // Suggested opener — varies by what we have.
  lines.push("## Suggested opener");
  if (accountState === "empty") {
    lines.push(
      "Greet the user by acknowledging they're just getting started with Google Ads.",
      "Reference the budget recommendation by name. End with an open question that",
      "invites them to talk through their first campaign. Keep it under 3 sentences.",
    );
  } else if (topFix) {
    lines.push(
      "Greet the user by referencing the top finding by name with the dollar figure.",
      "Make it personal and specific. End with an open question that invites them to",
      "either fix the top finding now or talk through the broader audit. Keep it under",
      "3 sentences.",
    );
  } else if (snapshot) {
    lines.push(
      "Greet the user by referencing the account snapshot by name (campaign + spend).",
      "If 0 conversions, mention installing conversion tracking as the first ongoing",
      "task. Otherwise mention the most relevant ongoing-work item from above. End",
      "with an open question. Keep it under 3 sentences.",
    );
  } else {
    lines.push(
      "Acknowledge that the audit ran cleanly and the account looks healthy from a",
      "30-day spend perspective. Ask the user what they'd like to optimize next.",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Write a tagged memory entry on the CMO agent so later sessions can recall
 * the audit via REM. Best-effort: subprocess failure does not block the
 * audit's completion event. Logged for debugging.
 */
async function safeWriteMemoryTag(
  project_slug: string,
  summary: AuditSummary,
): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const tag = `google-ads-baseline:${date}`;
    const content = `Google Ads baseline audit for ${project_slug} on ${date}: ${summary.count} findings, account_state=${summary.account_state}.`;
    await openclaw(
      [
        "memory",
        "write",
        "--agent",
        `${project_slug}-cmo`,
        "--tag",
        tag,
        "--content",
        content,
      ],
      { json: false },
    );
  } catch (err) {
    console.warn(`OpenClaw memory write failed for ${project_slug}:`, err);
  }
}

// ── tiny accessors ──────────────────────────────────────────────────

function getMetric(row: GaqlRow, dotted: string): number | undefined {
  const v = getNested(row, dotted);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function getString(row: GaqlRow, dotted: string): string | undefined {
  const v = getNested(row, dotted);
  return typeof v === "string" ? v : undefined;
}

function getNested(row: GaqlRow, dotted: string): unknown {
  const parts = dotted.split(".");
  let cur: unknown = row;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function microsAsDollars(micros: number | undefined): number {
  if (typeof micros !== "number" || !Number.isFinite(micros)) return 0;
  return micros / 1_000_000;
}

function slugifyForId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
