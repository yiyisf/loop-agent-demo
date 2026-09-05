# syntax=docker/dockerfile:1

# ---- build stage: install workspace deps, build shared + web + server ----
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps
RUN pnpm build
# Production-only node_modules for the server (native @libsql/client included).
RUN pnpm --filter @loop-agent/server deploy --prod --legacy /out/server

# ---- runtime stage: single process serving API + static web app ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    DATABASE_URL=file:/app/data/loop-agent.db \
    STATIC_DIR=/app/public \
    LOG_LEVEL=info
WORKDIR /app

COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /out/server/dist ./dist
COPY --from=build /out/server/package.json ./package.json
COPY --from=build /app/apps/web/dist ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
