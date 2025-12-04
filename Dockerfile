# syntax=docker/dockerfile:1

FROM node:22

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]
RUN ls -a
RUN npm install
COPY . .
# RUN npm test
RUN npm run build
CMD [ "node", "dist/server.js" ]
# To Start the Specific Consumer
# CMD ["node", "dist/consumers/index.js","--consumer=notification"] 