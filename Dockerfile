# Node 24: the server uses node:sqlite, which only exists from 22.5 and is
# stable in 24. Pinned to a minor so a base-image bump can't silently
# change the runtime.
FROM node:24.4-slim AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Produces dist/, which the server serves in production.
RUN npm run build


FROM node:24.4-slim AS runtime

ENV NODE_ENV=production
# All mutable state (SQLite database + uploaded photos) lives here so it
# can be a mounted volume and survive redeploys.
ENV DATA_DIR=/data

WORKDIR /app

# Production dependencies only — no Vite, oxlint or Playwright in the
# runtime image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

# Run unprivileged. The node image already provides the `node` user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3001

# Fly's health check hits /api/health; this also makes `docker ps` show
# real status when run directly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
