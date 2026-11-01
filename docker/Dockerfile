# syntax=docker/dockerfile:1.7
# Multi-stage build for the Plate image (linux/arm64 for the Raspberry Pi 5, linux/amd64 for laptops).
# Build from the repository root:  docker build -f docker/Dockerfile -t plate .

ARG NODE_VERSION=24

# ---------- builder: install everything, build shared -> api -> web ----------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /src

# Native modules (better-sqlite3, argon2) ship prebuilt binaries for linux arm64/amd64 glibc;
# the toolchain is only a fallback in case a prebuild is missing for a new Node release.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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

# Production node_modules for the API only (shared is bundled into dist by tsup).
RUN pnpm --filter @plate/api --prod deploy --legacy /out/api \
 && rm -rf /out/api/src /out/api/test

# ---------- runtime: small, non-root, read-only friendly ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    # The container network is the boundary; exposure is decided by the compose `ports:` mapping.
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/plate.db \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle

WORKDIR /app

COPY --from=builder /out/api/node_modules ./node_modules
COPY --from=builder /out/api/package.json ./package.json
COPY --from=builder /src/apps/api/dist ./dist
COPY --from=builder /src/apps/api/drizzle ./drizzle
COPY --from=builder /src/apps/web/dist ./web
COPY docker/healthcheck.mjs ./healthcheck.mjs

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "/app/healthcheck.mjs"]

CMD ["node", "/app/dist/server.js"]
