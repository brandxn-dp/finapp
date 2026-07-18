# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8484 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/package.json /app/server/package.json
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/web/dist /app/web/dist
VOLUME /data
EXPOSE 8484
CMD ["node", "dist/index.js"]
