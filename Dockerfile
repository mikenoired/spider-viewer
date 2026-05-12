# syntax=docker/dockerfile:1

FROM oven/bun:1.3.11 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runtime

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV SHUTDOWN_TIMEOUT_MS=30000

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/auth/shared.ts ./src/lib/auth/shared.ts
COPY --from=build /app/src/lib/db ./src/lib/db
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["node", "./scripts/serve.mjs"]
