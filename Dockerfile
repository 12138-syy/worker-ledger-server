# syntax=docker/dockerfile:1
# Sealos / Docker / GHCR 通用生产镜像
# 监听端口从 process.env.PORT 读取，默认 3000，绑定 0.0.0.0

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
