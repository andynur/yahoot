# Yahoot

A Kahoot-style live quiz for a real classroom: a teacher hosts on a projector,
100+ students join on phones with a PIN, answer timed questions, watch a live
leaderboard. The hard part is the real-time game session, not quiz CRUD.

## Stack — Bun-native only (Bun 1.4+)

Bun is runtime, package manager, bundler, test runner and dev server. HTTP:
`Bun.serve({ routes })`. Real-time: native Bun WebSocket pub/sub (topic = PIN).
Storage: `bun:sqlite` — one file holds accounts, quizzes, results **and** live
game state. Images: `Bun.Image` (built in — no sharp). Hashing: `Bun.password`.
Validation: Zod (server only — see rule 5).
Teacher JWT: `jose`. Frontend: React on Bun's fullstack server.

**Banned (Bun replaces them):** Express, Hono, Socket.IO, ws, pg, postgres.js,
Prisma, Drizzle, ioredis, node-redis, Vite, sharp.

## Architecture rules (non-negotiable)

1. Server is the only source of truth for time and score. Client shows a cosmetic
   countdown from the server `deadline`; late answers are rejected.
2. Live game state lives in the `live_*` SQLite tables, never process memory — a
   mid-game restart must not lose the session.
3. Closing a question must be claimed atomically (`store.claimScoring`). The
   state check inside `advance()` is not enough on its own: a whole class
   answering in one burst otherwise scores the room once per answer.
4. Every WebSocket message is defined once in `packages/shared/protocol.ts` as a
   Zod schema, imported by both sides. Never hand-write an untyped one.
5. Zod never reaches the browser. The client imports runtime values from
   `@shared/wire` and types with `import type` from `@shared/protocol`; the
   server still validates all inbound messages. `bun run build:web` fails if a
   value import drags Zod back in (it is larger than React).

## Content model

Two question kinds — `multiple_choice` (2–6 answers) and `true_false` (exactly
2). Each carries optional `media`: `none`, `image`, or `video`. Both live in
`QuestionKind` / `QuestionMedia` in `protocol.ts`.

`video` means **YouTube, and only YouTube** — `schemas.ts` rejects anything
`isYouTubeUrl` doesn't recognise. We never host video: one clip streamed to a
whole class would come off the same box that is running the game.

`image` is an uploaded file (`apps/server/uploads/`, served at `/uploads/…`) or
an external URL. Uploads are re-encoded on arrival by `http/images.ts` —
`Bun.Image`, capped at 1600px, WebP q80, one at a time — so a picture the whole
room downloads stays a few hundred KB no matter what the client sent. The
browser downscales first (`apps/web/src/image.ts`); the server is the guarantee,
not the optimisation.

## Monorepo

- `apps/server` — one Bun.serve: REST + WebSocket + game engine + `/uploads`,
  plus `db/` (SQLite + migrations) and `state/store.ts` (live game state)
- `apps/web` — React (teacher Dashboard + Host + Player views)
- `packages/shared` — `protocol.ts` (WS schemas) + `scoring.ts` (pure)

## Commands

`bun dev` · `bun test` · `bunx tsc --noEmit` · `bun run db:migrate` · `bun run db:seed`
`bun run build:web` · `bun run check:web` · `bun run loadtest` · `bun run audit`

## Deploying

The container ships the backend **plus the committed `apps/web/dist` bundle**,
served same-origin with `/api` and `/ws`; there is no external datastore — one
SQLite file at `DATABASE_PATH` holds everything. So the
frontend is built locally and committed — run `bun run build:web` and commit
`apps/web/dist` whenever the UI changes (`bun run check:web` catches a stale
bundle). Single replica only: Bun's WS pub/sub is per-process. See DEPLOY.md.

Deeper how-tos: the matching skill under `.claude/skills/` loads automatically.
