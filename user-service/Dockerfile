FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./

RUN npm ci --fetch-retries 5 --fetch-retry-maxtimeout 600000

COPY . .

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /usr/src/app

COPY --from=development /app/node_modules /usr/src/app/node_modules

COPY --from=development /app/dist /usr/src/app/dist

EXPOSE 3000

CMD ["node", "dist/main"]



