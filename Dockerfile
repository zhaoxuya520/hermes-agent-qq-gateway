FROM node:24-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
COPY README.md ./
COPY .env.example ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY README.md ./
COPY .env.example ./

CMD ["node", "dist/index.js"]
