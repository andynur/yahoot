---
name: bun-native-stack
description: Patterns and gotchas for Bun-native APIs in this repo — Bun.serve routes, native WebSocket pub/sub, bun:sqlite, Bun.Image, Bun.password. Load whenever writing or editing server code, database access, WebSocket handling, image uploads, or when tempted to add a Node library.
---

# Bun-native stack

One Bun binary is the runtime, bundler, test runner, package manager and dev
server. If a Node-ecosystem library exists for something Bun now does natively,
**do not add it** — see the ban list at the end.

Bun's TypeScript types moved around in 1.3–1.4 (especially `Bun.serve`
WebSocket types). Trust `node_modules/@types/bun` and the current docs at
bun.com/docs, not old blog posts. When unsure, delegate to the `docs-researcher`
subagent.

## Bun.serve — REST routes + WebSocket in one process

`apps/server/index.ts` keeps a module-level `server` reference so the engine can
`server.publish(pin, ...)` from anywhere (wrapped in `apps/server/bus.ts`).

```ts
const server = Bun.serve({
  port: env.SERVER_PORT,
  routes: {
    "/api/health": { GET: () => Response.json({ ok: true }) },
    "/api/quizzes/:id": { GET: getQuiz, PUT: updateQuiz, DELETE: deleteQuiz },
  },
  async fetch(req, server) {
    // fallback: only unmatched paths / methods reach here
    const url = new URL(req.url);
    if (url.pathname === "/ws") return handleUpgrade(req, server); // may return undefined
    return new Response("not found", { status: 404 });
  },
  websocket,          // WebSocketHandler<SocketData>
  error(err) { console.error(err); return new Response("error", { status: 500 }); },
});
```

- A route handler for `/x/:id` gets typed params: `(req: Bun.BunRequest<"/x/:id">) => req.params.id`.
- A request whose **method** doesn't match a route falls through to `fetch` (so
  CORS preflight `OPTIONS` is handled once in `fetch`).
- When a `websocket` handler is present, `fetch` / route handlers may return
  `undefined` (used after `server.upgrade`).

## Upgrading to WebSocket + pub/sub

PIN travels in the query string so `open` can subscribe immediately.

```ts
// in fetch():
const data: SocketData = { pin, role, playerId: null, teacherId };
return server.upgrade(req, { data }) ? undefined : new Response("nope", { status: 426 });

export const websocket: WebSocketHandler<SocketData> = {
  open(ws)  { ws.subscribe(ws.data.pin); },
  message(ws, raw) {
    const msg = parseClientMessage(typeof raw === "string" ? raw : raw.toString());
    if (!msg) return ws.send(JSON.stringify({ type: "ERROR", message: "bad message" }));
    // ...dispatch
  },
  close(ws) { ws.unsubscribe(ws.data.pin); },
};
```

Topics in this app: `<pin>` for public game events (host + all players),
`player:<id>` for one player's private events. A message type is sent on exactly
one of them — never both — so nobody gets duplicates.

Broadcast: `server.publish(topic, JSON.stringify(msg))`. Direct: `ws.send(...)`.
Always go through `apps/server/bus.ts` so the payload is typed `ServerToClient`.

## bun:sqlite

`apps/server/db/db.ts` opens the one database and exports thin helpers —
`all` / `get` / `run` / `tx` / `toJson` / `fromJson` / `nowIso`. Everything goes
through them; no other file constructs a `Database`.

```ts
const rows = all<QuizRow>("select id, title from quizzes where teacher_id = ?", teacherId);
const one  = get<{ id: string }>("select id from teachers where email = ?", email);
const changed = run("update quizzes set title = ? where id = ?", title, id); // rows affected
const id = tx(() => { run("insert into …"); run("insert into …"); return newId; });
```

The pragmas are set once at open: **WAL**, `synchronous = NORMAL`,
`busy_timeout = 5000`, `foreign_keys = ON` (the schema relies on
`ON DELETE CASCADE`).

Two things that follow from `bun:sqlite` being **synchronous**:

- A read-check-write inside a single function cannot interleave with another
  request. That is what makes `store.claimScoring` safe.
- There is no connection pool and no `await` — do not wrap these in extra
  promises "to be consistent". `state/store.ts` is `async` only because its call
  sites in the engine already were.

`db.ts` keeps its **own** prepared-statement cache. Bun's `db.query()` cache
holds ~20 statements and this server has ~60, so the hot path was re-preparing
almost every call (measured: 131 ms → 45 ms over 20k queries). The cache is
keyed by SQL string and never evicts, which is only safe because every string is
a literal — **never interpolate values into SQL**, only fixed identifiers from a
constant list.

`strict: true` on the Database is *not* used, and does not need to be: positional
`?` parameters already throw on a missing value ("expected 2 values, received
1"). Strict mode only changes named-parameter prefixes.

JSON columns are TEXT: write with `toJson(value)`, read with
`fromJson(row.col, fallback)`. There is no `jsonb`. A unique-constraint failure
surfaces as `err.code === "SQLITE_CONSTRAINT_UNIQUE"` / `"…_PRIMARYKEY"`.

Migrations: numbered files `db/migrations/NNN_name.sql`, applied in filename
order → `bun run db:migrate` (`db/migrate.ts` records applied names in
`_migrations`, so it is idempotent and runs on every container boot). Never edit
an applied migration; add a new one.

`DATABASE_PATH` is resolved against the **repo root**, not `process.cwd()` — the
dev server runs from `apps/server` while `db:seed` runs from the root, and a
cwd-relative path silently gives you two different databases.

## Bun.Image

Uploaded pictures are re-encoded before they hit disk
(`apps/server/http/images.ts`). Statically linked into the runtime — this is why
`sharp` is not, and must not become, a dependency.

```ts
const meta = await new Bun.Image(bytes).metadata();      // { width, height, format }
const out = await new Bun.Image(bytes, { maxPixels: 40e6, autoOrient: true })
  .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
  .webp({ quality: 80 })
  .bytes();
```

Gotchas that cost real time:

- Errors carry a `code` (`ERR_IMAGE_UNKNOWN_FORMAT`, `ERR_IMAGE_TOO_MANY_PIXELS`,
  …) — map those to a status rather than returning a generic 500.
- GIF **decodes first frame only** and there is no GIF encoder, so GIFs must pass
  through untouched or they lose their animation.
- Decoding allocates the full pixel buffer, so uploads are serialised in
  `images.ts`. Don't remove that on a box with 1 GB of RAM.
- A successful decode is also the proof that a file is an image. Never trust the
  multipart `Content-Type`.

## Bun.password

```ts
const hash = await Bun.password.hash(plain);          // argon2id by default
const ok = await Bun.password.verify(plain, hash);
```

## Do NOT add

`pg`, `postgres`, `postgres.js`, `Prisma`, `Drizzle` → use `bun:sqlite`.
`ioredis`, `node-redis` → live state is in the `live_*` tables, not a cache.
`sharp`, `jimp`, `imagemagick` → use `Bun.Image`.
`express`, `hono`, `fastify` → use `Bun.serve({ routes })`.
`socket.io`, `ws` → use native Bun WebSocket + pub/sub.
`vite`, `webpack` → use Bun's fullstack dev server (`apps/web/dev.ts`).
`bcrypt`, `argon2` → use `Bun.password`. `dotenv` → Bun loads `.env`.
