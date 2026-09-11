FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm install
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node

# `docker build --target test -t fire-test . && docker run --rm fire-test`
# runs the full vitest suite inside the same image/dependency set used above.
FROM base AS test
CMD ["npm", "test"]

FROM base
EXPOSE 8080
CMD ["npm", "start"]
