# Build a partir da raiz do monorepo:  docker build -f apps/api/Dockerfile -t imersa-api .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@imersa/api..."
RUN pnpm --filter @imersa/api build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --omit=dev --no-save --no-audit --no-fund @node-rs/argon2@2.2.2 @sentry/node@11.10.0 && npm cache clean --force
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3333}/health || exit 1
# Migrations: docker run --rm -e DATABASE_URL_OWNER=... imersa-api node dist/migrate.mjs
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
