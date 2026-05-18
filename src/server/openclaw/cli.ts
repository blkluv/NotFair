import { spawn } from "node:child_process";

export class OpenClawError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(message: string, stderr: string, exitCode: number | null) {
    super(message);
    this.name = "OpenClawError";
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export type OpenClawOptions = {
  /** Timeout in ms. Defaults to 30s. */
  timeout?: number;
  /** When true, expect JSON on stdout and parse. Defaults to true. */
  json?: boolean;
};

/**
 * Run an OpenClaw CLI command and return parsed stdout.
 * Always passes `--json` when `json: true` (default) — caller does not.
 */
export async function openclaw(
  args: string[],
  options: OpenClawOptions = {},
): Promise<unknown> {
  const timeout = options.timeout ?? 30_000;
  const wantJson = options.json ?? true;
  const finalArgs = wantJson && !args.includes("--json") ? [...args, "--json"] : args;

  return new Promise((resolve, reject) => {
    const proc = spawn("openclaw", finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new OpenClawError(`openclaw ${args[0] ?? ""} timed out after ${timeout}ms`, stderr, null));
    }, timeout);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new OpenClawError(
            "openclaw not found on PATH. Install: https://docs.openclaw.ai/install",
            "",
            null,
          ),
        );
        return;
      }
      reject(new OpenClawError(err.message, stderr, null));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new OpenClawError(
            `openclaw ${args.join(" ")} exited with code ${code}`,
            stderr,
            code,
          ),
        );
        return;
      }
      if (!wantJson) {
        resolve(stdout);
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : null);
      } catch (parseErr) {
        reject(
          new OpenClawError(
            `openclaw output was not valid JSON: ${(parseErr as Error).message}`,
            stderr,
            code,
          ),
        );
      }
    });
  });
}

/** Type-narrowed wrappers for common operations. */

export async function listAgents(): Promise<unknown> {
  return openclaw(["agents", "list"]);
}

export async function listCrons(): Promise<unknown> {
  return openclaw(["cron", "list"]);
}

export async function getHealth(): Promise<string> {
  return openclaw(["health"], { json: false }) as Promise<string>;
}

export async function isOpenClawAvailable(): Promise<boolean> {
  try {
    await openclaw(["--version"], { json: false, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
