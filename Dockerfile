# Stage 1: Build React UI
FROM oven/bun:1 AS web-builder
WORKDIR /app/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY web/ .
RUN bun run build

# Stage 2: Install backend deps
FROM oven/bun:1 AS backend-deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production
# Install Playwright Chromium for browser tool
RUN bunx playwright install chromium --with-deps 2>/dev/null || true

# Stage 3: Runtime
FROM oven/bun:1
WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
RUN --mount=from=backend-deps,source=/root/.cache/ms-playwright,target=/tmp/pw cp -r /tmp/pw /root/.cache/ms-playwright 2>/dev/null || true
COPY --from=web-builder /app/web/dist ./web/dist
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY env.example ./

# Data directories
RUN mkdir -p .agents .yassir

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["bun", "run", "src/web/index.ts"]
