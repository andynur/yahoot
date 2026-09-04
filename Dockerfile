# Yahoot — backend image.
#
# Scope: the Bun server only. The web app is built on a developer machine
# (`bun run build:web`) and its output is committed, so this image just copies
# apps/web/dist and serves it from the same origin as /api and /ws. That keeps
# the image small, needs no Node/React toolchain here, and makes an auto-deploy
# on a backend change fast.
#
# State lives in one SQLite file at DATABASE_PATH — mount a volume for it.

# ---- dependencies ----------------------------------------------------------
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until dependencies actually change.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile --production

# ---- runtime ---------------------------------------------------------------
FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    SERVER_PORT=3020 \
    WEB_DIST=/app/apps/web/dist/ \
    DATABASE_PATH=/data/yahoot.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# tsconfig carries the @shared/* path alias that Bun resolves at runtime.
COPY package.json tsconfig.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY apps/web/dist ./apps/web/dist
COPY docker-entrypoint.sh ./

# Uploaded question images belong on a mounted volume — anything written here
# without one is lost on the next deploy.
# /data holds the SQLite file, /app/apps/server/uploads the question images.
# Both need a volume — without one, a deploy wipes every quiz and picture.
RUN mkdir -p /app/apps/server/uploads /data \
 && chown -R bun:bun /app /data \
 && chmod +x /app/docker-entrypoint.sh

VOLUME ["/data", "/app/apps/server/uploads"]

USER bun
EXPOSE 3020

# Probes SQLite, not just "the process is alive".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${SERVER_PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
