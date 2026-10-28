FROM node:24-bookworm-slim
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.25.0 --registry=$NPM_REGISTRY
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=$NPM_REGISTRY
COPY . .
RUN pnpm run build && mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
