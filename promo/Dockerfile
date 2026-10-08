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
# The model files are checksum-verified so a changed release asset can't
# silently change the voice.
ARG KOKORO_ONNX_VERSION=0.6.1
ARG SOUNDFILE_VERSION=0.14.0
RUN python3 -m venv /opt/tts \
 && /opt/tts/bin/pip install -q --no-cache-dir kokoro-onnx==${KOKORO_ONNX_VERSION} soundfile==${SOUNDFILE_VERSION} \
 && mkdir -p /models \
 && curl -fsSL -o /models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
 && curl -fsSL -o /models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
 && printf '%s  %s\n' \
      7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5 /models/kokoro-v1.0.onnx \
      bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d /models/voices-v1.0.bin \
    | sha256sum -c -
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm install --no-save --ignore-scripts --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION}
ENV NODE_PATH=/deps/node_modules
# ESM imports (app/mcp-server.mjs) ignore NODE_PATH but do walk up to /node_modules.
RUN ln -s /deps/node_modules /node_modules
WORKDIR /repo
