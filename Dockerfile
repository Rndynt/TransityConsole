FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

FROM base AS installer
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api-server/package.json ./apps/api-server/
COPY apps/transity-console/package.json ./apps/transity-console/
COPY packages/api-client-react/package.json ./packages/api-client-react/
COPY packages/api-spec/package.json ./packages/api-spec/
COPY packages/api-zod/package.json ./packages/api-zod/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile

FROM installer AS frontend-builder
COPY apps/transity-console ./apps/transity-console
COPY packages ./packages
ENV PORT=3000
ENV BASE_PATH=/
RUN pnpm --filter @workspace/transity-console run build

FROM installer AS api-builder
COPY apps/api-server ./apps/api-server
COPY packages ./packages
RUN pnpm --filter @workspace/api-server run build

FROM base AS production
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api-server/package.json ./apps/api-server/
COPY packages/api-client-react/package.json ./packages/api-client-react/
COPY packages/api-spec/package.json ./packages/api-spec/
COPY packages/api-zod/package.json ./packages/api-zod/
COPY packages/db/package.json ./packages/db/

RUN pnpm install --frozen-lockfile --prod

COPY --from=api-builder /app/apps/api-server/dist ./apps/api-server/dist
COPY --from=frontend-builder /app/apps/transity-console/dist/public ./apps/transity-console/dist/public
COPY packages/db/migrations ./packages/db/migrations

ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/apps/transity-console/dist/public
ENV MIGRATIONS_DIR=/app/packages/db/migrations

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./apps/api-server/dist/index.mjs"]
