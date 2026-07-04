# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci runs the prepare script, which needs the husky guard to exist (it exits
# early here: no .git in the build context).
COPY .husky/install.mjs .husky/
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY .husky/install.mjs .husky/
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# To run a specific consumer instead of the HTTP server:
# CMD ["node", "dist/consumer/index.js", "--consumer=example"]
