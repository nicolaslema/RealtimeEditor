FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

ENV HOST=0.0.0.0
ENV WS_PORT=1234
ENV WS_PERSISTENCE_DIR=/data/documents
ENV WS_SAVE_DEBOUNCE_MS=700

EXPOSE 1234

CMD ["pnpm", "start:ws"]

