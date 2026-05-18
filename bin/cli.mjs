#!/usr/bin/env node
// notfair-cmo CLI entry point.
// Compiled-free: stays as plain ESM JS so it works straight from npm without a build step
// for the CLI surface. The Next.js app itself is built and shipped under .next/standalone.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { Command } from "commander";
import open from "open";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);
const DATA_DIR = process.env.NOTFAIR_CMO_DATA_DIR ?? join(homedir(), ".notfair-cmo");

const program = new Command();
program
  .name("notfair-cmo")
  .description("Local AI marketing CMO portal. Orchestrates OpenClaw marketing agents.")
  .version(readPackageVersion());

program
  .command("start", { isDefault: true })
  .description("Start the local server and open the UI in your browser.")
  .option("-p, --port <port>", "Port to bind", "3000")
  .option("--no-open", "Do not auto-open the browser")
  .option("--data-dir <dir>", "Override data directory", DATA_DIR)
  .action(async (opts) => {
    const desired = Number.parseInt(opts.port, 10);
    const port = await findFreePort(desired);
    if (port !== desired) {
      console.log(`Port ${desired} was busy, using ${port} instead.`);
    }

    ensureDataDir(opts.dataDir);

    const standalonePath = join(PKG_ROOT, ".next", "standalone", "server.js");
    if (!existsSync(standalonePath)) {
      console.error("Build artifacts not found. This usually means you're running");
      console.error("from source without a build. Run: pnpm build");
      console.error(`Expected: ${standalonePath}`);
      process.exit(2);
    }

    // Next.js standalone output omits .next/static and public by default; copy
    // them in if they're missing so the server can serve CSS/JS chunks.
    ensureStandaloneAssets();

    const url = `http://127.0.0.1:${port}`;
    const child = spawn("node", [standalonePath], {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NOTFAIR_CMO_DATA_DIR: opts.dataDir,
      },
    });

    console.log(`notfair-cmo running on ${url}`);

    if (opts.open !== false) {
      setTimeout(() => {
        open(url).catch(() => {
          console.log(`Open ${url} in your browser.`);
        });
      }, 800);
    }

    const shutdown = () => {
      child.kill("SIGTERM");
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("doctor")
  .description("Verify OpenClaw is installed and reachable.")
  .action(async () => {
    let allOk = true;

    process.stdout.write("Checking OpenClaw on PATH... ");
    const oc = await runCheck("openclaw", ["--version"]);
    if (oc.ok) {
      console.log(`ok (${oc.stdout.trim()})`);
    } else {
      console.log("MISSING");
      console.log("  Install: https://docs.openclaw.ai/install");
      allOk = false;
    }

    if (oc.ok) {
      process.stdout.write("Checking OpenClaw gateway health... ");
      const health = await runCheck("openclaw", ["health"]);
      if (health.ok) {
        console.log("ok");
      } else {
        console.log("UNREACHABLE");
        console.log("  Start it with: openclaw gateway");
        allOk = false;
      }
    }

    process.stdout.write("Checking data dir is writable... ");
    try {
      ensureDataDir(DATA_DIR);
      console.log(`ok (${DATA_DIR})`);
    } catch (err) {
      console.log("FAILED");
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
      allOk = false;
    }

    process.stdout.write("Checking for an LLM API key... ");
    const hasKey = !!(
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
    if (hasKey) {
      console.log("ok");
    } else {
      console.log("MISSING");
      console.log("  Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY");
      allOk = false;
    }

    process.exit(allOk ? 0 : 1);
  });

program
  .command("stop")
  .description("Stop any running notfair-cmo instances on this machine.")
  .action(() => {
    console.log("Stop is not implemented yet. Use Ctrl+C in the running terminal,");
    console.log("or kill the node process bound to your notfair-cmo port.");
    process.exit(1);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

// --- helpers ---

function ensureStandaloneAssets() {
  const standaloneStatic = join(PKG_ROOT, ".next", "standalone", ".next", "static");
  const sourceStatic = join(PKG_ROOT, ".next", "static");
  if (!existsSync(standaloneStatic) && existsSync(sourceStatic)) {
    cpSync(sourceStatic, standaloneStatic, { recursive: true });
  }
  const standalonePublic = join(PKG_ROOT, ".next", "standalone", "public");
  const sourcePublic = join(PKG_ROOT, "public");
  if (!existsSync(standalonePublic) && existsSync(sourcePublic)) {
    cpSync(sourcePublic, standalonePublic, { recursive: true });
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function ensureDataDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function findFreePort(start, maxTries = 10) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port) => {
      const server = createServer();
      server.once("error", (err) => {
        server.close();
        if (err.code === "EADDRINUSE" && attempt < maxTries) {
          attempt += 1;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };
    tryPort(start);
  });
}

function runCheck(cmd, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: "" }));
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr: "timed out" });
    }, 5000);
  });
}
