/**
 * Build the brief for the CMO's first task — the audit that used to be its
 * own special-purpose code path in src/server/onboarding/audit.ts. Now the
 * audit IS a task: the CMO does the GAQL probes itself via the Google Ads
 * MCP, writes findings inline, and delegates ongoing work via the
 * notfair-orchestration MCP tools (the same surface the CMO uses for every
 * other planning turn — see agent-templates.ts for the full teaching).
 *
 * Keeping this server-side so the wording stays in lockstep with the CMO
 * system prompt; templated rather than free-form so each new project
 * onboarding receives the same expectations.
 */
export function buildOnboardingBrief(args: {
  project_slug: string;
  project_display_name: string;
  google_ads_account_id: string | null;
}): { title: string; brief: string; success_criteria: string } {
  const account = args.google_ads_account_id ?? "(none picked — ask the user)";

  const title = "Audit the account and propose a starter playbook";

  const brief = [
    `Project: ${args.project_display_name} (${args.project_slug})`,
    `Google Ads account: ${account}`,
    "",
    "This is your first turn as CMO for this project. Audit the connected",
    "Google Ads account, present findings, then delegate ongoing work to",
    "the google-ads specialist.",
    "",
    "## 1. Probe the account",
    "",
    "Use the notfair-googleads MCP `runScript` tool to gather (GAQL via",
    "`ads.gaql`, fan out with `ads.gaqlParallel`):",
    "- Customer info: status, currency, time zone",
    "- Last 30 days per enabled campaign: cost, impressions, clicks,",
    "  conversions, conversion_value",
    "- Conversion tracking: count of conversion_actions + recent_conversions",
    "- Search terms (last 30d) with cost > $10 and conversions = 0",
    "- Keywords with quality_score < 5",
    "- Campaigns within $5 of their daily budget cap",
    "",
    "## 2. Classify the archetype",
    "",
    "One of:",
    "- empty — no enabled campaigns",
    "- no_tracking — campaigns but zero conversion_actions",
    "- low_volume — < 50 clicks / month or < $200 spend",
    "- active — meaningful data to optimize on",
    "",
    "## 3. Report findings to the user (in this reply)",
    "",
    "Markdown, scannable. Sections (skip any with no findings, don't pad):",
    "- **Account snapshot** — 1-2 sentences naming the archetype + spend",
    "- **Wasted spend** — top 3 search-term gaps with $ amounts",
    "- **Low quality scores** — top 3 keywords + their QS",
    "- **Budget pacing** — campaigns hitting cap",
    "- **Next steps** — 3 concrete actions tailored to the archetype",
    "",
    "Lead with the dollar figure or the most actionable finding. Don't ask",
    '"want me to..." — you\'re an orchestrator; delegate, don\'t advise.',
    "",
    "## 4. Delegate the ongoing work",
    "",
    "For each Next Step that's actionable + repeatable, delegate it to the",
    "google_ads specialist. Include the cadence in the brief itself (\"daily",
    "9am Pacific anomaly check on enabled campaigns\", \"weekly Monday",
    "search-term review\", etc.) — the specialist will schedule its own cron.",
    "",
    "Tight one-line tail after delegating: \"Handed these to your Google Ads",
    'specialist — open the agent\'s Tasks tab to follow along."',
  ].join("\n");

  const success_criteria = [
    "Findings reported as inline markdown; ongoing work delegated to",
    "google_ads (skip delegation when archetype = empty); this audit task",
    "marked done.",
  ].join(" ");

  return { title, brief, success_criteria };
}
