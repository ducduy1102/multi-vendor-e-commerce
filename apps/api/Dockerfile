# syntax=docker/dockerfile:1

# Build from the repo root: docker build -f apps/api/Dockerfile -t ecommerce-api .
# Migrate as a pre-deploy step: ./node_modules/.bin/prisma migrate deploy
# No secrets in the image; env vars come from the platform at runtime.

ARG NODE_VERSION=20
# Keep in sync with "packageManager" in the root package.json.
ARG PNPM_VERSION=10.34.5

# Debian slim with OpenSSL (Prisma needs libssl); build and runtime share this base.
FROM node:${NODE_VERSION}-bookworm-slim AS os
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM os AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
# Dev dependencies are needed to build and for the prisma CLI, so NODE_ENV must not be production here.
RUN pnpm install --frozen-lockfile --filter "api..."

COPY packages/types packages/types
COPY apps/api apps/api

RUN pnpm --filter @ecommerce/types build
# prisma.config.ts requires DATABASE_URL, so generate gets a dummy value that is not kept in the image.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter api exec prisma generate
RUN pnpm --filter api build

FROM os AS runtime
# tini as PID 1 so the container receives SIGTERM.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Keep the /repo path: pnpm node_modules use relative symlinks.
WORKDIR /repo

COPY --from=build --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /repo/node_modules node_modules

COPY --from=build --chown=node:node /repo/packages/types/package.json packages/types/package.json
COPY --from=build --chown=node:node /repo/packages/types/dist packages/types/dist
COPY --from=build --chown=node:node /repo/packages/types/node_modules packages/types/node_modules

COPY --from=build --chown=node:node /repo/apps/api/package.json /repo/apps/api/prisma.config.ts apps/api/
COPY --from=build --chown=node:node /repo/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist

WORKDIR /repo/apps/api
USER node
# The platform sets PORT; the app falls back to 3000.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
