# ── Stage 1: 安装依赖 + 构建 ────────────────────────────────
FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++ git
WORKDIR /app
# Copy everything first so pnpm workspace symlinks reference actual source
COPY . .
RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @risk-agent/core build \
    && pnpm --filter @risk-agent/web build \
    && pnpm --filter @risk-agent/server build

# ── Stage 3: 最终运行镜像 ─────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache \
    dumb-init \
    wget

# 创建非 root 用户（server-deployment.md §2.1）
RUN addgroup -g 1001 -S nodejs \
    && adduser -S risk-agent -u 1001 -G nodejs

ENV NODE_ENV=production
ENV RISK_AGENT_DATA_DIR=/data
ENV RISK_AGENT_HOST=0.0.0.0
ENV RISK_AGENT_PORT=4100

RUN mkdir -p /data && chown risk-agent:nodejs /data

COPY --from=build --chown=risk-agent:nodejs /app /app

USER risk-agent

EXPOSE 4100
VOLUME ["/data"]

# 健康检查（server-deployment.md §7）
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4100/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/server/dist/index.js"]
