import type { AgentTemplateKey } from "@/server/agent-templates";

/**
 * Per-agent color palette used by the cron calendar so users can scan which
 * agent owns which job at a glance. Deliberately distinct hues that all read
 * well against the zinc neutral background.
 */
export type AgentColor = {
  /** Tailwind classes: chip background + text color. */
  chip: string;
  /** Solid dot/legend swatch. */
  dot: string;
  /** Label color when only the label is shown. */
  label: string;
};

const PALETTE: Record<AgentTemplateKey, AgentColor> = {
  cmo: {
    chip: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100 border-blue-200/60 dark:border-blue-900",
    dot: "bg-blue-500",
    label: "text-blue-700 dark:text-blue-300",
  },
  google_ads: {
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100 border-amber-200/60 dark:border-amber-900",
    dot: "bg-amber-500",
    label: "text-amber-700 dark:text-amber-300",
  },
  seo: {
    chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 border-emerald-200/60 dark:border-emerald-900",
    dot: "bg-emerald-500",
    label: "text-emerald-700 dark:text-emerald-300",
  },
};

const FALLBACK: AgentColor = {
  chip: "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 border-zinc-200/60 dark:border-zinc-800",
  dot: "bg-zinc-500",
  label: "text-zinc-700 dark:text-zinc-300",
};

/**
 * Resolve a color for an agent slug as it appears in our cron view.
 * Accepts both URL slugs ("google-ads") and template keys ("google_ads").
 */
export function colorForAgentSlug(slug: string): AgentColor {
  const normalized = slug.replace(/-/g, "_") as AgentTemplateKey;
  return PALETTE[normalized] ?? FALLBACK;
}
