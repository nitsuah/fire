# Render image for promo spots: Playwright/Chromium + ffmpeg + numpy/scipy,
# Kokoro TTS for narration, and the app's production deps in /deps so
# capture.js can boot the real server.
# Build from the repo root: docker build -f promo/Dockerfile .
ARG PLAYWRIGHT_VERSION=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3-numpy python3-scipy python3-venv curl fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
# Narration: Kokoro-82M (Apache-2.0) via kokoro-onnx, offline once built.
# Its own venv because Debian's numpy can't be upgraded in place.
ARG KOKORO_ONNX_VERSION=0.6.1
RUN python3 -m venv /opt/tts \
 && /opt/tts/bin/pip install -q --no-cache-dir kokoro-onnx==${KOKORO_ONNX_VERSION} soundfile \
 && mkdir -p /models \
 && curl -fsSL -o /models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
 && curl -fsSL -o /models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm install --no-save --ignore-scripts --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION}
ENV NODE_PATH=/deps/node_modules
# ESM imports (app/mcp-server.mjs) ignore NODE_PATH but do walk up to /node_modules.
RUN ln -s /deps/node_modules /node_modules
WORKDIR /repo
