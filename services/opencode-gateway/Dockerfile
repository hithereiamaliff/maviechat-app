# MavieChat's OpenCode gateway. No npm packages: Node 24 runs the TypeScript source directly.
FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin/maviechat-gateway /usr/local/bin/maviechat-gateway
RUN chmod 755 /usr/local/bin/maviechat-gateway && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8080 ADMIN_PORT=8081 DATA_DIR=/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health > /dev/null || exit 1
CMD ["node", "src/server.ts"]
