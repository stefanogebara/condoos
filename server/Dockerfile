# CondoOS API — Node 20 + better-sqlite3 (native)
FROM node:20-alpine AS build
WORKDIR /app

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/scripts ./scripts
COPY server/src ./src
RUN npm run build

# Runtime image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY server/package.json ./
COPY server/src/db/schema.sql ./dist/db/schema.sql

# Mounted Fly volume for SQLite file persistence
VOLUME ["/data"]
ENV DB_PATH=/data/condoos.sqlite
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
