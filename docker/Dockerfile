# syntax=docker/dockerfile:1.7
# Multi-stage build for the Plate image (linux/arm64 for the Raspberry Pi 5, linux/amd64 for laptops).
# Build from the repository root:  docker build -f docker/Dockerfile -t plate .
#
# Both stages are Alpine (musl): better-sqlite3 ships prebuilds/linuxmusl-{arm64,x64}.node and argon2
# ships *.musl.node, so no compiler toolchain is needed and the runtime image is ~150 MB instead of
# the ~565 MB of the Debian-based variant. If a future Node release lacks a musl prebuild, switch
# both FROM lines back to node:${NODE_VERSION}-bookworm-slim and add `apt-get install python3 make g++`
# to the builder.

ARG NODE_VERSION=24

# ---------- builder: install everything, build shared -> api -> web ----------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /src

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

# Dependency manifests first so the install layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

RUN pnpm --filter @plate/api build \
 && pnpm --filter @plate/web build

# Production node_modules for the API only (shared is bundled into dist by tsup). Then drop what the
# runtime never loads: better-sqlite3's bundled SQLite source tree and the prebuilds for other
# platforms (busybox sh has no brace expansion, hence the explicit list).
RUN pnpm --filter @plate/api --prod deploy --legacy /out/api \
 && rm -rf /out/api/src /out/api/test \
 && find /out/api/node_modules -path '*/better-sqlite3/deps' -type d -prune -exec rm -rf {} + \
 && find /out/api/node_modules -path '*/better-sqlite3/prebuilds/*' -type f \
      ! -name 'linuxmusl-*' -delete \
 && find /out/api/node_modules -path '*/argon2/prebuilds/*' -type f \
      ! -name '*.musl.node' -delete

# ---------- runtime: small, non-root, read-only friendly ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    # The container network is the boundary; exposure is decided by the compose `ports:` mapping.
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/plate.db \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle

# su-exec: drop from root to the app user after the entrypoint has fixed /data ownership.
RUN apk add --no-cache su-exec

WORKDIR /app

# --chown at copy time: a separate `chown -R` would duplicate every file into a new 90 MB layer.
COPY --from=builder --chown=node:node /out/api/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/api/package.json ./package.json
COPY --from=builder --chown=node:node /src/apps/api/dist ./dist
COPY --from=builder --chown=node:node /src/apps/api/drizzle ./drizzle
COPY --from=builder --chown=node:node /src/apps/web/dist ./web
COPY --chown=node:node docker/healthcheck.mjs ./healthcheck.mjs
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/plate-entrypoint

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "/app/healthcheck.mjs"]

# Root here; the entrypoint switches to `node` before the server starts (see docker/entrypoint.sh).
ENTRYPOINT ["plate-entrypoint"]
CMD ["node", "/app/dist/server.js"]
