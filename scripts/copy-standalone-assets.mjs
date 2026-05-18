#!/usr/bin/env node
// Next.js standalone output (`output: "standalone"`) intentionally does NOT
// include `.next/static/` or `public/` so they can be served from a CDN in
// production. We ship as a local-first npm package, so we copy them into the
// standalone tree where `server.js` will serve them automatically.

import { existsSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const STANDALONE = join(ROOT, ".next", "standalone");

if (!existsSync(STANDALONE)) {
  console.error(`No standalone output found at ${STANDALONE}. Did 'next build' run?`);
  process.exit(1);
}

const targets = [
  { src: join(ROOT, ".next", "static"), dest: join(STANDALONE, ".next", "static") },
  { src: join(ROOT, "public"), dest: join(STANDALONE, "public") },
];

for (const { src, dest } of targets) {
  if (!existsSync(src)) continue;
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src.replace(ROOT + "/", "")} → ${dest.replace(ROOT + "/", "")}`);
}
