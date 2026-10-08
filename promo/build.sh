#!/usr/bin/env bash
# Rebuild a promo spot end to end in Docker. Never touches data/db.json:
# the app runs against promo/demo-seed.js in a throwaway DB.
#
#   promo/build.sh                         # full render of brag-22s
#   promo/build.sh brag-22s --stills 1.8,2.6,6.2   # quick look at a few frames
#   promo/build.sh brag-22s --audio        # re-synth audio + remux only
#   promo/build.sh brag-22s --recapture    # re-shoot the app (after UI/seed changes)
#   promo/build.sh brag-22s --publish      # also copy the web cut into site/assets/
#   promo/build.sh chaos-24s --publish     # Chaos-mode spot → site/assets/chaos.mp4
#   promo/build.sh tour-85s --audio --publish  # narrated tour → site/assets/tour.mp4 (720p)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd -W 2>/dev/null || pwd)"   # Windows path under Git Bash

SPOT="brag-22s"; MODE="full"; TIMES=""; RECAPTURE=0; PUBLISH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --stills) MODE="stills"; TIMES="$2"; shift 2 ;;
    --audio) MODE="audio"; shift ;;
    --recapture) RECAPTURE=1; shift ;;
    --publish) PUBLISH=1; shift ;;
    -*) echo "unknown option $1"; exit 1 ;;
    *) SPOT="$1"; shift ;;
  esac
done

docker info >/dev/null 2>&1 || { echo "Docker Desktop isn't running."; exit 1; }
echo "== image"
docker build -q -f promo/Dockerfile -t fire-promo . >/dev/null
mkdir -p promo/out
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$REPO:/repo:ro" -v "$REPO/promo/out:/out" \
  -e RECAPTURE="$RECAPTURE" \
  fire-promo sh /repo/promo/pipeline.sh "$SPOT" "$MODE" "$TIMES"

if [ "$PUBLISH" = 1 ] && [ "$MODE" != stills ]; then
  case "$SPOT" in
    brag-22s) VID=fire-tracker.mp4; POS=poster.jpg ;;
    chaos-24s) VID=chaos.mp4; POS=chaos-poster.jpg ;;
    tour-85s) VID=tour.mp4; POS=tour-poster.jpg ;;
    *) echo "no publish target for $SPOT"; exit 1 ;;
  esac
  if [ "$SPOT" = tour-85s ]; then
    # The long tour plays on demand, so the site gets a lighter 720p cut.
    MSYS_NO_PATHCONV=1 docker run --rm -v "$REPO:/repo" fire-promo ffmpeg -hide_banner -loglevel error -y       -i "/repo/promo/out/$SPOT/$SPOT.mp4" -vf scale=1280:-2 -c:v libx264 -preset slow -crf 27       -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 96k "/repo/site/assets/$VID"
  else
    cp "promo/out/$SPOT/$SPOT-web.mp4" "site/assets/$VID"
  fi
  cp "promo/out/$SPOT/$SPOT.jpg" "site/assets/$POS"
  echo "published → site/assets/$VID, $POS"
fi
