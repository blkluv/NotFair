import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionBySessionIdMock = vi.fn();
const loadSessionHistoryMock = vi.fn();
vi.mock("@/server/openclaw/sessions", () => ({
  findSessionBySessionId: (agentFullId: string, threadId: string) =>
    findSessionBySessionIdMock(agentFullId, threadId),
  loadSessionHistory: (agentFullId: string, sessionId: string) =>
    loadSessionHistoryMock(agentFullId, sessionId),
  buildPendingSessionKey: (agentFullId: string, threadId: string) =>
    `agent:${agentFullId}:${threadId}`,
}));

import { loadThreadHistory } from "./thread-history";

describe("loadThreadHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves threadId → OpenClaw sessionId, then loads history with sessionId (not threadId)", () => {
    // URL threadId is "thread-abc" but OpenClaw's internal sessionId for
    // that thread is "internal-xyz" — distinct values. Previous bug: we
    // called loadSessionHistory(threadId), got an empty file, kickoff
    // re-fired. Fix: resolve via findSessionBySessionId first.
    findSessionBySessionIdMock.mockReturnValueOnce({
      sessionId: "internal-xyz",
      label: "thread-abc",
      sessionKey: "agent:demo-google-ads:thread-abc",
      lastInteractionAt: 1,
      pending: false,
    });
    loadSessionHistoryMock.mockReturnValueOnce([
      { id: "0", role: "user", body: "(task assignment) ...", timestamp: 1 },
      { id: "1", role: "assistant", body: "On it.", timestamp: 2 },
    ]);

    const out = loadThreadHistory("demo-google-ads", "thread-abc");

    expect(loadSessionHistoryMock).toHaveBeenCalledWith(
      "demo-google-ads",
      "internal-xyz",
    );
    expect(loadSessionHistoryMock).not.toHaveBeenCalledWith(
      "demo-google-ads",
      "thread-abc",
    );
    expect(out.sessionKey).toBe("agent:demo-google-ads:thread-abc");
    expect(out.history).toHaveLength(2);
  });

  it("returns pending sessionKey + empty history when threadId is unknown to OpenClaw", () => {
    // First open of a freshly-minted thread — OpenClaw hasn't seen it
    // yet, so findSessionBySessionId returns null. Caller should treat
    // as pending (no history, sessionKey is a fresh pending one).
    findSessionBySessionIdMock.mockReturnValueOnce(null);
    const out = loadThreadHistory("demo-google-ads", "fresh-thread");
    expect(out.history).toEqual([]);
    expect(out.sessionKey).toBe("agent:demo-google-ads:fresh-thread");
    expect(loadSessionHistoryMock).not.toHaveBeenCalled();
  });
});
