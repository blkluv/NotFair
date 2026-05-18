# Contributing

Thanks for poking around! notfair-cmo is small, opinionated, and willing to grow.

## Dev setup

```bash
git clone <repo>
cd notfair-cmo
pnpm install
```

Native deps (`better-sqlite3`, `keytar`) need build approvals on pnpm — already configured in `package.json` under `pnpm.onlyBuiltDependencies`, just runs on install.

Make sure you have:
- Node 20+ (24 preferred)
- OpenClaw installed and `openclaw gateway` running
- Whatever LLM provider your OpenClaw uses (the project inherits `agents.defaults.model`)

```bash
pnpm typecheck   # tsc --noEmit
pnpm dev          # next dev --turbopack
pnpm build        # next build (standalone output)
pnpm cli          # tsx bin/cli.ts (CLI in dev)
```

## Project shape

See `ARCHITECTURE.md`. Short version:
- Frontend: Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui
- Backend: Next.js server actions + SQLite (better-sqlite3) + subprocess wrapper around `openclaw`
- No MCP server — agents use OpenClaw's built-in `exec` tool

## Adding a feature

1. Open an issue describing the user-facing change (the *what* and *why*).
2. Branch off main.
3. Build it. Keep modules small. shadcn primitives over custom CSS.
4. Run `pnpm typecheck && pnpm build`. Both must pass.
5. If you're touching cron / agent / approval / OAuth flows, exercise it end-to-end against a real OpenClaw install — the test agents we ship as scripts/ examples are the right starting point.
6. Update README / ARCHITECTURE if behavior changed.
7. Open a PR. Describe what you changed and how to verify.

## Module conventions

- Server-only modules live in `src/server/`. Anything in there can use `node:*` modules + native deps.
- Client components: start the file with `"use client";`.
- Server actions: `"use server";`. Throw on validation failure (form actions) or return discriminated `{ok: true, ...} | {ok: false, error}` (programmatic).
- Database access: only via helpers in `src/server/db/`. Don't reach for `getDb()` from a component or route.
- OpenClaw access: only via helpers in `src/server/openclaw/`. Don't shell out to `openclaw` directly from a route.
- Slugs: only via `src/lib/slug.ts`. Reserved words checked.
- Types: shared types go in `src/types/`. Server-only types stay near their server module.

## Style

- TypeScript strict mode. No `any` unless interfacing with untyped externals.
- Prefer named exports. Default exports only for Next.js pages/layouts/route handlers.
- shadcn/ui defaults — no custom color palette, no custom typography, no decorative blobs. The zinc neutral palette is the brand for V0.x.

## Testing

V0.1 doesn't ship a test suite (intentionally — we validated end-to-end against a real OpenClaw install instead of writing mocks). Test infrastructure lands in V0.2 along with the eval harness.

If you want to add tests now: Vitest for unit, Playwright for E2E. Mock OpenClaw at the subprocess wrapper level (`src/server/openclaw/cli.ts`).

## License

By contributing, you agree your contributions are licensed under MIT.
