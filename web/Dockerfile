# 画面（Next.js）。複数の PC のブラウザが開く入口。API と Console へはコンテナ間のネットワークで中継する
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor vendor
RUN npm ci --no-audit --no-fund
COPY . .
# rewrites はビルド時に固定されるので、中継先はここで決める（compose のサービス名）。Agent Console へは API が中継する
ARG PORTAL_API_URL=http://api:4401
ENV PORTAL_API_URL=$PORTAL_API_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORTAL_BIND=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4400
CMD ["npm", "run", "start"]
