# ============================================================
# Social Dots Design Studio — Production Dockerfile
# Multi-stage: Next.js standalone build + Express API server
# ============================================================

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Copy the standalone Next.js server
COPY --from=builder /app/.next/standalone ./

# Copy required static assets and public folder
COPY --from=builder /app/.next/static ./.next/static/
COPY --from=builder /app/public ./public/

# Copy Express API server
COPY server.js ./server.js
COPY src/providers/ src/providers/
COPY src/artifacts/ src/artifacts/

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
