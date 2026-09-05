# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/bazi-engine/package.json packages/bazi-engine/package.json
COPY packages/export-documents/package.json packages/export-documents/package.json
COPY packages/knowledge-contracts/package.json packages/knowledge-contracts/package.json
COPY services/knowledge-mcp/package.json services/knowledge-mcp/package.json
COPY fengshui-report-plugin/package.json fengshui-report-plugin/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm -C deepseek-harness install --frozen-lockfile
RUN pnpm -C deepseek-harness build

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    STORAGE_DRIVER=postgres \
    MIGRATIONS_PATH=/app/apps/api/migrations \
    FENGSHUI_KNOWLEDGE_API_URL=http://127.0.0.1:3001 \
    PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@fengshui/api", "start"]

FROM nginx:1.27-bookworm AS web
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

FROM nginx:1.27-bookworm AS admin
COPY infra/nginx/admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
