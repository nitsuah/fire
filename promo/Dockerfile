# Render image for promo spots: Playwright/Chromium + ffmpeg + numpy/scipy,
# with the app's production deps in /deps so capture.js can boot the real
# server. Build from the repo root: docker build -f promo/Dockerfile .
ARG PLAYWRIGHT_VERSION=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3-numpy python3-scipy fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm install --no-save --ignore-scripts --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION}
ENV NODE_PATH=/deps/node_modules
WORKDIR /repo
