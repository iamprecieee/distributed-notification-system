FROM node:18-alpine AS development

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:18-alpine AS production

WORKDIR /usr/src/app

COPY --from=builder /app/node_modules /usr/src/app/node_modules

COPY --from=builder /app/dist /usr/src/app/dist

EXPOSE 3000

CMD ["node", "dist/main"]