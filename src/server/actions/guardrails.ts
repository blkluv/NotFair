"use server";

import { revalidatePath } from "next/cache";
import { setGuardrails, getGuardrails } from "@/server/db/guardrails";

export async function updateGuardrailsAction(
  project_slug: string,
  formData: FormData,
): Promise<void> {
  const current = getGuardrails(project_slug);
  const max_daily_spend_usd = num(formData.get("max_daily_spend_usd"), current.max_daily_spend_usd);
  const max_concurrent_experiments = num(
    formData.get("max_concurrent_experiments"),
    current.max_concurrent_experiments,
  );
  const spend_per_action_usd = num(
    formData.get("spend_per_action_usd"),
    current.require_approval_above.spend_per_action_usd,
  );
  const bid_changes_percent = num(
    formData.get("bid_changes_percent"),
    current.require_approval_above.bid_changes_percent,
  );

  setGuardrails({
    project_slug,
    max_daily_spend_usd,
    max_concurrent_experiments,
    require_approval_above: {
      spend_per_action_usd,
      new_channel_first_action: formData.get("new_channel_first_action") === "on",
      content_publishing: formData.get("content_publishing") === "on",
      bid_changes_percent,
      audience_change: formData.get("audience_change") === "on",
    },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

function num(v: FormDataEntryValue | null, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
