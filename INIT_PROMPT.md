# Master Init Prompt — Kahoot Clone (Bun-native monorepo + Claude Code harness)

> Paste this whole file into Claude Code (in VS Code) as your first message in an **empty project folder**.
> It tells Claude Code both *what to build* and *how to set itself up* so future sessions stay fast and token-cheap.

---

## Your role

You are initializing a new project. Work in **phases, in order**. After each phase, stop and show me a one-line summary of what you created, then continue. Before any destructive action (deleting files, overwriting an existing config), ask first. Do not install any dependency that is not listed below without asking.

## What we are building

A **Kahoot-style live quiz** for real classroom use at a high school: a teacher hosts on a projector, 100+ students join on their phones with a game PIN, answer timed questions, and see a live leaderboard. The hard part is the **real-time game session**, not the quiz CRUD.

## Locked tech decisions (do not substitute)

- **Runtime / package manager / bundler / test runner / dev server:** Bun 1.4+ only. One binary for everything.
- **HTTP:** native `Bun.serve({ routes })`. **No Express, no Hono, no framework.**
- **Real-time:** native Bun WebSocket with built-in **pub/sub** (topic = game PIN). **No Socket.IO, no ws, no Pusher.**
- **Database:** PostgreSQL via native `Bun.sql` (tagged templates). **No pg, no postgres.js, no Prisma, no Drizzle.**
- **Cache / live state:** Redis via native `Bun.redis`. **No ioredis, no node-redis.**
- **Password hashing:** native `Bun.password`.
- **Validation / shared types:** Zod, in `packages/shared`.
- **Auth (teacher sessions):** JWT via `jose` (only non-native dependency allowed on the server).
- **Frontend:** React served by Bun's native fullstack dev server (HMR + React Fast Refresh). **No Vite.**

If you catch yourself reaching for a Node-ecosystem library that Bun now provides natively, stop — use the Bun-native API instead.

## Non-negotiable architecture rules (these also go into the harness)

1. **The server is the only source of truth for time and score.** The client only renders a cosmetic countdown from a server-sent `deadline` timestamp. Score = correctness × time remaining, computed **only on the server**. Answers arriving after the server closes the question are rejected.
2. **Live game state lives in Redis, never in process memory.** A server restart mid-game must not lose the session.
3. **Never write to Postgres per answer.** During play, scores live in Redis. Only the **final results** are persisted to Postgres when the game ends.
4. **All WebSocket messages are defined once** in `packages/shared/protocol.ts` as Zod schemas, imported by both server and web. Never hand-write an untyped message on either side.

---

## Execution plan

### Phase 0 — Preconditions
- Run `bun --version`; confirm it is 1.4 or newer. If older, tell me and stop.
- Confirm the current directory is empty (or only has `.git`). If not, list what's there and ask before continuing.

### Phase 1 — Monorepo skeleton
Create a Bun workspace:
```
package.json            # workspaces: ["apps/*", "packages/*"], root scripts
tsconfig.base.json      # strict: true, module: "Preserve"
.gitignore              # node_modules, .env, dist, *.local
.env.example            # DATABASE_URL, REDIS_URL, JWT_SECRET
apps/
  server/
  web/
packages/
  shared/
```
Root scripts: `dev` (runs server + web), `test` (`bun test`), `typecheck` (`bunx tsc --noEmit`), `format`.

### Phase 2 — `packages/shared`
- `protocol.ts`: Zod schemas + inferred types for every WS message. Split into `ClientToServer` (e.g. `PLAYER_JOIN`, `PLAYER_ANSWER`, `PLAYER_REJOIN`, `HOST_START_QUESTION`, `HOST_NEXT`) and `ServerToClient` (e.g. `QUESTION_SHOWN`, `ANSWER_ACCEPTED`, `ANSWER_REJECTED`, `QUESTION_CLOSED`, `LEADERBOARD`, `GAME_ENDED`, `STATE_SNAPSHOT`). Each carries the fields it needs; `QUESTION_SHOWN` must carry an absolute `deadline` (epoch ms).
- `scoring.ts`: a pure function `computeScore({ correct, deadline, answeredAt, maxPoints })`. No I/O.
- Export a single discriminated-union type per direction so both sides get exhaustive checking.

### Phase 3 — `apps/server` (single process: REST + WS)
- `index.ts`: one `Bun.serve` with `routes` for REST **and** a `websocket` handler; keep a module-level reference to the returned `server` for `server.publish(pin, ...)`.
- REST routes (thin): teacher register/login (`Bun.password` + `jose` JWT), quiz CRUD, create game session (generates PIN), fetch results.
- WS: on open `ws.subscribe(pin)`; on message, parse with the shared Zod schema, dispatch to the game engine; on close `ws.unsubscribe(pin)`.
- `game/engine.ts`: the state machine `LOBBY → QUESTION_ACTIVE → ANSWERS_LOCKED → REVEAL → LEADERBOARD → (loop | ENDED)`. All transitions server-driven. Question open sets a server-side timer that auto-closes at `deadline`.
- `db/` : `sql.ts` (the `Bun.sql` client) + numbered migration files `db/migrations/001_init.sql`, run by a tiny `db/migrate.ts` script.
- `state/redis.ts`: the `Bun.redis` client + helpers to read/write the live session snapshot keyed by PIN.

### Phase 4 — `apps/web` (React, Bun dev server)
- `index.html` entry that Bun bundles directly.
- Two routes/views: **Host** (projector: PIN, current question, live leaderboard) and **Player** (join with PIN + nickname, answer buttons, result).
- `useGameSocket.ts`: one hook that opens the WS, sends typed messages from `@shared/protocol`, handles reconnect (store `playerId` + `pin` in `sessionStorage`, send `PLAYER_REJOIN`, apply `STATE_SNAPSHOT`).
- Keep client state in React only. No extra state library yet.

### Phase 5 — The Claude Code harness
Create exactly the files specified in **"Harness files"** below — no more. Keep `CLAUDE.md` short; push all detail into skills.

### Phase 6 — Verify
- `bun install`
- `bunx tsc --noEmit` (fix type errors)
- `bun test` (add at least one test for `computeScore` and one for a state-machine transition)
- Start `bun dev` and confirm both apps boot. Report the URLs.

---

## Harness files (create these verbatim in intent)

> Philosophy to preserve for the life of the repo: **`CLAUDE.md` loads on every prompt, so it stays lean** (aim < ~40 lines). Anything longer, situational, or reference-like becomes a **skill** (loads only when its description matches). Noisy, throwaway work (doc lookups, full-file reviews) goes to a **subagent** so it never pollutes the main context.

### `CLAUDE.md` (repo root — keep it this short)
Include only:
- One-paragraph project description.
- The locked stack as a compact list (Bun-native only; the "no Express/Hono/Socket.IO/pg/Prisma/ioredis/Vite" ban).
- The 4 non-negotiable architecture rules above, one line each.
- The monorepo map (3 lines).
- Commands: `bun dev`, `bun test`, `bunx tsc --noEmit`, `bun run db:migrate`.
- A pointer: "For deeper how-tos, the relevant skill under `.claude/skills/` will load automatically."

Do **not** put code examples, API references, or long explanations in `CLAUDE.md` — those go in skills.

### `.claude/skills/bun-native-stack/SKILL.md`
Frontmatter:
```yaml
---
name: bun-native-stack
description: Patterns and gotchas for Bun-native APIs in this repo — Bun.serve routes, native WebSocket pub/sub, Bun.sql (Postgres), Bun.redis, Bun.password. Load whenever writing or editing server code, database access, WebSocket handling, or when tempted to add a Node library.
---
```
Body: concrete snippets for `Bun.serve({ routes })`, upgrading to WS + `subscribe`/`server.publish`, `Bun.sql` tagged-template queries and the `sql.array` helper, `Bun.redis` get/set for session snapshots, `Bun.password.hash/verify`, and the numbered-`.sql` migration convention. Include the Bun 1.3 gotcha: `Bun.serve()` WebSocket TypeScript types were reworked — follow current Bun docs, not old tutorials. End with the explicit "do not add pg/ioredis/express/hono/socket.io" reminder.

### `.claude/skills/realtime-protocol/SKILL.md`
Frontmatter:
```yaml
---
name: realtime-protocol
description: How to add or change any WebSocket message. Load whenever a new client↔server event is needed or an existing one changes.
---
```
Body: the rule that every message is defined first in `packages/shared/protocol.ts` as a Zod schema in the correct direction union, then handled on the server, then on the client — in that order. Show the pattern for adding one new message end to end. State that server handlers must `safeParse` incoming messages and reject invalid ones.

### `.claude/skills/game-flow/SKILL.md`
Frontmatter:
```yaml
---
name: game-flow
description: The authoritative game state machine, timer, and scoring rules. Load whenever editing the game engine, question timing, scoring, or leaderboard logic.
---
```
Body: the `LOBBY → QUESTION_ACTIVE → ANSWERS_LOCKED → REVEAL → LEADERBOARD → loop/ENDED` machine; server owns the timer via a deadline + server-side timeout; scoring via `computeScore` only on the server; late answers rejected; live scores in Redis, only final results to Postgres. Include the anti-cheat rationale in one line so it isn't "optimized away."

### `.claude/agents/docs-researcher.md`
Frontmatter:
```yaml
---
name: docs-researcher
description: Fetches and summarizes Bun / library documentation. Use when you need to verify a current API instead of guessing. Returns only a short summary to the parent.
tools: Read, Grep, Glob, WebFetch, WebSearch
permission-mode: ask
load-claude-md: false
---
```
Body: instruct it to prefer official Bun docs (bun.com/docs), confirm the API against the installed Bun version, and return a compact answer (signature + one example + any version caveat) — never dump whole pages back.

### `.claude/agents/code-reviewer.md`
Frontmatter:
```yaml
---
name: code-reviewer
description: Read-only review of changed files against this repo's non-negotiable rules. Use after implementing a feature. Returns a short pass/fail list, not a rewrite.
tools: Read, Grep, Glob
---
```
Body: check specifically for (1) client-side timing or scoring, (2) per-answer Postgres writes, (3) live state kept in process memory instead of Redis, (4) untyped WS messages bypassing `protocol.ts`, (5) any banned Node library. Report each as pass/fail with file:line. Do not edit files.

### `.claude/settings.json`
Set least-privilege permissions and two lifecycle hooks. Use roughly this shape (adjust field names to match the current Claude Code settings schema if they differ):
```json
{
  "permissions": {
    "allow": ["Bash(bun:*)", "Bash(bunx:*)", "Bash(git:*)", "Read", "Edit", "Write"],
    "deny": ["Read(./.env)", "Read(./**/.env)", "Read(./**/.env.*)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "bun run format" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bun test" }] }
    ]
  }
}
```
Also create `.claude/settings.local.json` (gitignored) as an empty `{}` for my machine-specific overrides, and add it to `.gitignore`.

---

## Guardrails for you (Claude Code) during and after init

- Everything in `.claude/` is committed to git so future sessions and teammates inherit the harness — except `settings.local.json`.
- Keep `CLAUDE.md` under ~40 lines forever. When it grows, move the new material into a skill instead.
- When unsure about a current Bun/library API, delegate to the `docs-researcher` subagent rather than guessing.
- After finishing a feature, run the `code-reviewer` subagent before telling me it's done.
- Prefer editing `packages/shared/protocol.ts` before touching either app whenever a message shape changes.

When all six phases pass, give me: the tree of what you created, the dev URLs, and the single next feature you recommend implementing first.
