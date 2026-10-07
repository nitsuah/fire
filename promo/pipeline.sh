#!/bin/sh
# Runs inside the promo image (see build.sh). /repo is the repo (read-only),
# /out is promo/out on the host.
#   pipeline.sh <spot> full            capture (if needed) → narration → frames → audio → mp4
#   pipeline.sh <spot> stills "1,2.5"  capture (if needed) → narration → stills only
#   pipeline.sh <spot> audio           narration + music only (+ remux if frames exist)
# Tour spots (spot.json "type": "tour") use the shared promo/tour/compose.html
# and bed.py; their length comes from the narration (timeline.json).
set -eu
SPOT="$1"; MODE="${2:-full}"; TIMES="${3:-}"
DIR="/repo/promo/$SPOT"; W="/out/$SPOT"
[ -f "$DIR/spot.json" ] || { echo "no such spot: promo/$SPOT"; exit 1; }
mkdir -p "$W"
TYPE=$(node -p "require('$DIR/spot.json').type || 'custom'")
NARRATED=$(node -p "const s=require('$DIR/spot.json'); s.type==='tour' || !!(s.narration||[]).length")

if [ "${RECAPTURE:-0}" = 1 ] || [ ! -f /out/capture/mcp-status.json ]; then
  echo "== capture (real app + demo seed)"
  rm -rf /out/capture
  node /repo/promo/capture.js
fi

rm -f "$W/timeline.json" "$W/vo.wav"
if [ "$NARRATED" = true ]; then
  echo "== narration"
  /opt/tts/bin/python /repo/promo/narrate.py "$DIR/spot.json" "$W"
fi

# compose.html resolves crops/… relative to itself, so stage it next to a copy of the crops.
if [ "$TYPE" = tour ]; then cp /repo/promo/tour/compose.html "$W/compose.html"; else cp "$DIR/compose.html" "$W/compose.html"; fi
rm -rf "$W/crops"; cp -r /out/capture/crops "$W/crops"

if [ "$MODE" = stills ]; then
  echo "== stills $TIMES"
  node /repo/promo/render.js "$SPOT" "$TIMES"
  echo "stills → promo/out/$SPOT/stills/"; exit 0
fi

if [ "$MODE" = full ]; then
  echo "== frames"
  node /repo/promo/render.js "$SPOT"
fi

echo "== audio"
if [ "$TYPE" = tour ]; then
  python3 /repo/promo/tour/bed.py "$DIR/spot.json" "$W/timeline.json" "$W/audio-raw.wav"
else
  python3 "$DIR/synth.py" "$DIR/spot.json" "$W/audio-raw.wav"
fi
LOUD="loudnorm=I=-14:TP=-1.5:LRA=11:linear=true"
if [ -f "$W/vo.wav" ]; then
  # Voice on top; music ducks under it (sidechain) and sits lower overall.
  ffmpeg -hide_banner -loglevel error -y -i "$W/audio-raw.wav" -i "$W/vo.wav" -filter_complex \
    "[1:a]aresample=44100,highpass=f=80,pan=stereo|c0=c0|c1=c0,volume=1.6,asplit=2[vo][key];\
     [0:a]volume=0.55[m];[m][key]sidechaincompress=threshold=0.025:ratio=8:attack=15:release=380[duck];\
     [duck][vo]amix=inputs=2:duration=first:normalize=0,$LOUD[out]" \
    -map "[out]" -ar 44100 "$W/audio.wav"
else
  ffmpeg -hide_banner -loglevel error -y -i "$W/audio-raw.wav" -af "$LOUD" -ar 44100 "$W/audio.wav"
fi

[ -d "$W/frames" ] || { echo "no frames yet; run full first"; exit 1; }
echo "== encode"
FPS=$(node -p "require('$DIR/spot.json').fps || 30")
POSTER=$(node -p "const s=require('$DIR/spot.json'); const fs=require('fs'); const tl=fs.existsSync('$W/timeline.json')&&require('$W/timeline.json'); String(Math.round(((tl&&tl.poster)||s.poster)*(s.fps||30))).padStart(4,'0')")
# Poster frame doubles as frame 0 so every platform's thumbnail shows it;
# replaced (not added) so duration and audio sync stay the same.
[ -f "$W/frames/f0000.orig.png" ] || cp "$W/frames/f0000.png" "$W/frames/f0000.orig.png"
cp "$W/frames/f$POSTER.png" "$W/frames/f0000.png"
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$W/frames/f%04d.png" -i "$W/audio.wav" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest "$W/$SPOT.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$W/frames/f$POSTER.png" -q:v 2 "$W/$SPOT.jpg"
# Smaller cut for the GitHub Pages hero.
ffmpeg -hide_banner -loglevel error -y -i "$W/$SPOT.mp4" -c:v libx264 -preset slow -crf 24 \
  -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "$W/$SPOT-web.mp4"
cp "$DIR/share-copy.txt" "$W/share-copy.txt"
ffmpeg -hide_banner -i "$W/audio.wav" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | tail -1 | sed 's/^ */loudness: /'
echo "done → promo/out/$SPOT/$SPOT.mp4"
