import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

/**
 * Minimal OpenClaw Gateway WebSocket client for streaming chat.
 *
 * Wire protocol (lifted from openclaw/openclaw `ui/src/ui/gateway.ts`):
 *   - Open WS to ws://<host>:<port>
 *   - Server may emit `event: connect.challenge` with a nonce; we ignore for
 *     token-only auth on loopback.
 *   - Client sends `{ type: "req", id, method: "connect", params: {...} }`
 *     with auth.token; server replies `{ type: "res", ok: true, payload: helloOk }`.
 *   - All requests use `{ type: "req", id, method, params }` and receive
 *     `{ type: "res", id, ok, payload?, error? }`.
 *   - Streaming chat tokens arrive as `{ type: "event", event: "chat", payload }`
 *     events; payload includes { runId, sessionKey, state, deltaText, message }.
 *
 * URL + token discovery: read OpenClaw's own config file. We never hard-code
 * port or host — the user's `~/.openclaw/openclaw.json` (or
 * `OPENCLAW_STATE_DIR`/profile path) is the source of truth.
 */

// --- Discovery ---

export type GatewayConfig = {
  url: string; // ws://host:port
  token?: string;
  password?: string;
  configFile: string;
};

function resolveConfigFile(): string {
  const dir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.OPENCLAW_HOME?.trim() ||
    join(homedir(), ".openclaw");
  return join(dir, "openclaw.json");
}

export function discoverGateway(): GatewayConfig {
  const configFile = resolveConfigFile();
  if (!existsSync(configFile)) {
    throw new Error(
      `OpenClaw config not found at ${configFile}. Is OpenClaw installed and configured?`,
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Could not parse ${configFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const gateway = (parsed.gateway ?? {}) as Record<string, unknown>;

  // Prefer remote URL if user configured one; otherwise build from port + bind.
  const remote = (gateway.remote ?? {}) as Record<string, unknown>;
  const remoteUrl = typeof remote.url === "string" ? remote.url.trim() : "";
  let url = remoteUrl;

  if (!url) {
    const port = Number(gateway.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`Could not read gateway.port from ${configFile}`);
    }
    const bind = typeof gateway.bind === "string" ? gateway.bind : "loopback";
    // For loopback/auto, connect to 127.0.0.1. For lan/tailnet, the user
    // typically also sets gateway.remote.url; if not, loopback is the safest
    // local default.
    const host = bind === "lan" || bind === "tailnet" ? "127.0.0.1" : "127.0.0.1";
    url = `ws://${host}:${port}`;
  }

  const auth = (gateway.auth ?? {}) as Record<string, unknown>;
  const token = typeof auth.token === "string" && auth.token.length > 0 ? auth.token : undefined;
  const password =
    typeof auth.password === "string" && auth.password.length > 0 ? auth.password : undefined;

  return { url, token, password, configFile };
}

// --- Frame types ---

type ReqFrame = { type: "req"; id: string; method: string; params?: unknown };
type ResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};
type EventFrame = { type: "event"; event: string; payload?: unknown; seq?: number };
type AnyFrame = ResFrame | EventFrame | { type: string; [k: string]: unknown };

// Wide protocol range so the gateway picks whatever it supports. Older
// installs speak protocol 3; newer ones speak 4+. The server returns the
// chosen version in hello-ok.
const CLIENT_MIN_PROTOCOL = 2 as const;
const CLIENT_MAX_PROTOCOL = 10 as const;

export type GatewayConnectOptions = {
  /** override discovery. */
  url?: string;
  token?: string;
  password?: string;
  /** scopes to request; default operator.read + write (enough for chat.send). */
  scopes?: string[];
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: Error) => void }
  >();
  private eventListeners = new Set<(evt: EventFrame) => void>();
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private readonly cfg: GatewayConfig;
  private readonly scopes: string[];

  constructor(opts: GatewayConnectOptions = {}) {
    const discovered = discoverGateway();
    this.cfg = {
      url: opts.url ?? discovered.url,
      token: opts.token ?? discovered.token,
      password: opts.password ?? discovered.password,
      configFile: discovered.configFile,
    };
    // Local single-user app; default to admin so config mutations (skills.update,
    // crons CRUD) work without per-call scope juggling.
    this.scopes = opts.scopes ?? [
      "operator.read",
      "operator.write",
      "operator.admin",
    ];
  }

  /** Open + connect, idempotent. */
  async open(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openInternal().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async openInternal(): Promise<void> {
    const ws = new WebSocket(this.cfg.url, {
      perMessageDeflate: false,
      handshakeTimeout: 5_000,
    });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => reject(err);
      ws.once("error", onErr);
      ws.once("open", () => {
        ws.removeListener("error", onErr);
        resolve();
      });
    });

    ws.on("message", (raw) => this.handleMessage(String(raw)));
    ws.on("close", () => {
      this.connected = false;
      for (const p of this.pending.values()) {
        p.reject(new Error("gateway connection closed"));
      }
      this.pending.clear();
    });
    ws.on("error", () => {
      // Errors after open propagate via close.
    });

    // Send connect frame and wait for hello-ok payload.
    await this.request("connect", {
      minProtocol: CLIENT_MIN_PROTOCOL,
      maxProtocol: CLIENT_MAX_PROTOCOL,
      client: {
        id: "gateway-client",
        version: "0.1.0",
        platform: process.platform,
        mode: "backend",
        instanceId: process.pid.toString(),
      },
      role: "operator",
      scopes: this.scopes,
      caps: [],
      ...(this.cfg.token || this.cfg.password
        ? { auth: { token: this.cfg.token, password: this.cfg.password } }
        : {}),
      userAgent: `notfair-cmo/0.1.0 node/${process.versions.node}`,
      locale: "en-US",
    });
    this.connected = true;
  }

  close(): void {
    this.connected = false;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.pending.clear();
    this.eventListeners.clear();
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = randomUUID();
    const frame: ReqFrame = { type: "req", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify(frame));
    });
  }

  addEventListener(listener: (evt: EventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private handleMessage(raw: string): void {
    let parsed: AnyFrame;
    try {
      parsed = JSON.parse(raw) as AnyFrame;
    } catch {
      return;
    }
    if (parsed.type === "res") {
      const res = parsed as ResFrame;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.payload);
      else {
        const detailsStr = res.error?.details
          ? ` details=${JSON.stringify(res.error.details).slice(0, 300)}`
          : "";
        p.reject(
          new Error(
            `gateway error (${res.error?.code ?? "UNKNOWN"}): ${res.error?.message ?? "request failed"}${detailsStr}`,
          ),
        );
      }
      return;
    }
    if (parsed.type === "event") {
      const evt = parsed as EventFrame;
      // connect.challenge is for device auth; we don't use it on loopback +
      // shared-token. Safe to ignore.
      if (evt.event === "connect.challenge") return;
      for (const listener of this.eventListeners) {
        try {
          listener(evt);
        } catch (err) {
          console.error("[gateway-client] event listener error:", err);
        }
      }
    }
  }
}

// --- High-level streaming chat helper ---

export type StreamChatInput = {
  sessionKey: string;
  sessionId?: string;
  message: string;
  /** Cancellation signal. When aborted, we issue chat.abort and stop. */
  signal?: AbortSignal;
};

export type ChatStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; message: string };

/**
 * Stream a chat turn from OpenClaw. Yields incremental delta text events as
 * the agent produces tokens, then a final event with the full text once done.
 *
 * Strategy: subscribe to `event: "chat"` frames filtered to our runId. Each
 * payload carries the merged text in message.content[0].text; we compute the
 * delta against what we've already yielded so the consumer sees pure new
 * characters per event (cleaner than relying on the gateway's optional
 * `deltaText` field which can have buffering quirks).
 */
export async function* streamChatViaGateway(
  input: StreamChatInput,
): AsyncGenerator<ChatStreamEvent, void, void> {
  const client = new GatewayClient();
  await client.open();

  const runId = randomUUID();
  const events: ChatStreamEvent[] = [];
  let done = false;
  let lastEmittedLen = 0;
  let resolveWait: (() => void) | null = null;

  const wake = () => {
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = null;
      r();
    }
  };

  const unsubscribe = client.addEventListener((evt) => {
    if (evt.event !== "chat") return;
    const payload = evt.payload as
      | {
          runId?: string;
          state?: string;
          deltaText?: string;
          replace?: boolean;
          message?: { content?: Array<{ type?: string; text?: string }> };
        }
      | undefined;
    if (!payload || payload.runId !== runId) return;

    const merged = extractText(payload.message?.content);
    if (merged.length > lastEmittedLen) {
      const delta = merged.slice(lastEmittedLen);
      lastEmittedLen = merged.length;
      events.push({ kind: "delta", text: delta });
      wake();
    }
    if (payload.state === "final" || payload.state === "complete") {
      events.push({ kind: "final", text: merged });
      done = true;
      wake();
    }
  });

  // Wire abort: best-effort chat.abort + bail out.
  const onAbort = () => {
    void client.request("chat.abort", { sessionKey: input.sessionKey, runId }).catch(() => {});
    done = true;
    wake();
  };
  if (input.signal) {
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    // Fire the request. The promise resolves quickly with the runId-or-ack
    // payload; streaming text arrives as events.
    void client
      .request("chat.send", {
        sessionKey: input.sessionKey,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        message: input.message,
        deliver: false,
        idempotencyKey: runId,
      })
      .catch((err: Error) => {
        events.push({ kind: "error", message: err.message });
        done = true;
        wake();
      });

    while (!done || events.length > 0) {
      while (events.length > 0) {
        yield events.shift()!;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        // Safety: time-bounded wait so we never hang forever if events stop.
        setTimeout(() => {
          if (resolveWait === resolve) {
            resolveWait = null;
            resolve();
          }
        }, 30_000);
      });
    }
  } finally {
    unsubscribe();
    if (input.signal) input.signal.removeEventListener("abort", onAbort);
    client.close();
  }
}

function extractText(content: Array<{ type?: string; text?: string }> | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}
