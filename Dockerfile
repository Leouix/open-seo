# OpenSEO as a small production image: docker build -t openseo . && docker run -p 3000:3000 -v openseo-data:/data openseo

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.10.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    OPENSEO_DATA_DIR=/data \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# For MCP clients that only speak stdio: docker exec -i openseo node mcp-stdio.mjs
COPY --from=build /app/scripts/mcp-stdio.mjs ./mcp-stdio.mjs
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node data/settings.json /data/settings.json
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
