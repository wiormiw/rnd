# syntax=docker/dockerfile:1

# One knob for both the build image and the distroless runtime image.
ARG NODE_VERSION=26

# Build stages use Debian (glibc), the same libc as the distroless runtime.
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
RUN corepack enable

# Production dependencies only: this is what ships.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Full install plus compile. Never shipped.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# One-off job: `docker build --target migrate`, then run it with DB_URL set.
# The runtime image has no shell and no drizzle-kit, so migrations live here.
FROM build AS migrate
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
USER node
CMD ["node_modules/.bin/drizzle-kit", "migrate"]

# Default target. Distroless: no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
# package.json is required: its "type": "module" makes Node load dist/*.js as ESM.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
# No curl in distroless, so probe liveness with Node itself.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The image entrypoint is already `node`.
CMD ["dist/main.js"]
