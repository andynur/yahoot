# Deploying Yahoot

The container ships **the backend plus the pre-built frontend**, and keeps all
state in one SQLite file. There is no database service to run.

## Why the frontend is built locally

`apps/web/dist` is committed to the repo. The image copies it and the Bun server
serves it from the same origin as `/api` and `/ws`. So:

- the image needs no React/Node toolchain — it stays ~116 MB and builds in seconds
- a backend-only change redeploys without rebuilding the UI
- whatever bundle you built last is exactly what gets served

The cost is one rule: **rebuild and commit the bundle whenever the UI changes.**

```bash
bun run build:web      # writes apps/web/dist
bun run check:web      # fails if dist is older than src — run before committing
git add apps/web/dist && git commit
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | generate: `openssl rand -hex 32` — never reuse the dev value |
| `DATABASE_PATH` | no | defaults to `/data/yahoot.db` in the image — keep it on a volume |
| `PORT` | no | injected by most hosts; defaults to `3020` |
| `WEB_ORIGIN` | no | your `https://` domain. Only used for CORS; the app is same-origin |
| `AUTO_MIGRATE` | no | `1` (default) applies pending migrations on boot; `0` to skip |
| `NODE_ENV` | preset | `production` in the image — tightens CORS |

## Easypanel

1. **Create the app.** Source = this Git repo, build method = **Dockerfile**
   (the `Dockerfile` is at the repo root; no build args needed). No database
   service is needed.

2. **Environment.** Set `JWT_SECRET`. Everything else has a working default.

3. **Port.** `3020`. Easypanel's proxy terminates TLS and forwards WebSocket
   upgrades, so `wss://your-domain/ws` reaches the server with no extra config.

4. **Volumes — do not skip these.** Mount one at each path:

   | Path | Holds |
   |---|---|
   | `/data` | the SQLite database — accounts, quizzes, results |
   | `/app/apps/server/uploads` | teacher-uploaded question images |

   Without them a deploy wipes every quiz and picture.

5. **Domain.** Attach your domain and enable HTTPS. The client derives its API
   and WebSocket URLs from the page origin, so nothing needs configuring.

6. **Health check.** `GET /api/health` actually queries the SQLite file and
   returns `503` if it cannot be read, not just when the process is dead. The
   image already declares a Docker `HEALTHCHECK` against it.

## Deploying an update

```bash
# UI changed?
bun run build:web && bun run check:web && git add apps/web/dist

git commit -am "…" && git push        # Easypanel auto-deploys
```

Migrations run automatically on boot and are idempotent.

## Run it locally the way production runs

```bash
docker build -t yahoot .
docker run --rm -p 3050:3020 \
  -v yahoot-data:/data \
  -v yahoot-uploads:/app/apps/server/uploads \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  yahoot
```

Then load-test it exactly as deployed:

```bash
TARGET=http://localhost:3050 CLIENTS=80 bun run loadtest
```

## Sizing

Measured at 80 concurrent players: **~130 MB RAM, ~1 % CPU**, answer round-trip
p95 **3 ms**, zero dropped messages; still clean at 150. With no database
service beside it, **1 GB / 1 vCPU is enough**; 2 GB gives comfortable headroom.

Backups are `cp /data/yahoot.db` (or `sqlite3 yahoot.db ".backup out.db"` for a
consistent copy while running).

## One constraint

Run **a single replica**. Bun's WebSocket pub/sub is per-process, so two
instances would split the room — students on instance A would never receive
broadcasts from instance B. At this scale one process is far from loaded.
