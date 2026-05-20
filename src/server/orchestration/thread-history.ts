import {
  buildPendingSessionKey,
  findSessionBySessionId,
  loadSessionHistory,
  type ChatMessage,
} from "@/server/openclaw/sessions";

/**
 * Resolve `threadId → (sessionKey, history)` for an agent.
 *
 * Why this helper exists: the URL threadId we mint is the LABEL half of
 * OpenClaw's sessionKey (`agent:<agent>:<label>`), NOT OpenClaw's internal
 * `sessionId` (a different UUID OpenClaw assigns when it writes the
 * transcript JSONL on first turn). loadSessionHistory takes that internal
 * sessionId. Passing the URL threadId directly silently returns [] for any
 * existing thread — which then trips autoKickoff and re-runs the agent.
 *
 * Both the agent's per-thread chat page and the per-task chat thread on
 * /tasks/[id] use this helper so the discrepancy can't bite again.
 */
export function loadThreadHistory(
  agentFullId: string,
  threadId: string,
): { sessionKey: string; history: ChatMessage[] } {
  const existing = findSessionBySessionId(agentFullId, threadId);
  const sessionKey =
    existing?.sessionKey ?? buildPendingSessionKey(agentFullId, threadId);
  const history = existing
    ? loadSessionHistory(agentFullId, existing.sessionId)
    : [];
  return { sessionKey, history };
}

