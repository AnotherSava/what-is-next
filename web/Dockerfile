# Production image for "What's next" (brief §9). Two stages share ONE base (Ubuntu 24.04 + Node 24) so the
# native module better-sqlite3 is built and run against the same glibc. The runtime runs the slim `next build`
# standalone output (`node server.js`). The BUILDER stage doubles as the migrate/seed toolchain (it carries the
# Prisma CLI + Linux engines + tsx + the schema/migrations) — run from a one-shot compose service on start.

# ── base: Ubuntu 24.04 + Node 24 ─────────────────────────────────────────────
FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── builder: install deps, generate the Prisma client, build the standalone bundle ──
FROM base AS builder
# Install with the lockfile first so the dep layer caches independently of source edits.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Generate the client (gitignored) then build. Standalone doesn't copy public/ or .next/static, so fold them in.
# The build is env-independent (all pages are dynamic — no DB access at build time).
RUN npx prisma generate \
    && npm run build \
    && cp -r public .next/standalone/ \
    && cp -r .next/static .next/standalone/.next/

# ── runtime: the standalone server ───────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# The traced standalone server + its static assets (better-sqlite3's native binary is traced in). The SQLite DB
# and backups live on the volume mounted at /data.
COPY --from=builder /app/.next/standalone ./
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
