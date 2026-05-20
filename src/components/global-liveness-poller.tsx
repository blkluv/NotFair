"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lives in the app sidebar (rendered on every route), so the sidebar's
 * per-agent live-task badges + the per-page task list groups stay fresh
 * no matter where the user is sitting — /home, /approvals, /tasks, an
 * agent workspace, etc. — while something is in flight somewhere.
 *
 * Replaces the workspace-scoped AgentLivenessPoller. Same idea, just
 * lifted to the layout level so non-workspace pages don't go stale.
 *
 * Cadence: 5 s while `hasInFlight` is true. The first refresh that lands
 * a server-rendered `hasInFlight = false` flips the prop, the effect
 * tears the interval down, and we stop spending requests on idle state.
 * Paperclip uses 10 s + a WebSocket push for instant invalidation; at
 * single-user local-CLI scale, 5 s polling is fine and one fewer moving
 * part than a WS server.
 */
export function GlobalLivenessPoller({ hasInFlight }: { hasInFlight: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(interval);
  }, [hasInFlight, router]);
  return null;
}
