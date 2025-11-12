FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --fetch-retries 5 --fetch-retry-maxtimeout 600000

COPY . .

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

USER nestjs

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD /usr/local/bin/node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/main"]