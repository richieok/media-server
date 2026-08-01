FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# adapter-node bundles its dependencies into build/, so no runtime install.
COPY --from=build /app/build ./build
COPY package.json ./

ENV PORT=5000
EXPOSE 5000

CMD ["node", "build"]
