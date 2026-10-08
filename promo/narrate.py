# Narration for a promo spot: Kokoro TTS (offline, in the promo image) →
# vo.wav, captions.srt and timeline.json in the spot's output folder.
#
#   /opt/tts/bin/python narrate.py <spot.json> <out dir>
#
# Two kinds of spot:
#   - Fixed timeline (brag-22s, chaos-24s): spot.json has "narration":
#     [{"t": 3.2, "say": "..."}]. Lines start at t; the step fails if a
#     line runs into the next one or past the end, so timing stays honest.
#   - Tour (type "tour"): every scene has "say". Scene length follows the
#     voice-over: max(min, lead + speech + tail). timeline.json carries the
#     resulting start/end for compose.html and bed.py.
#
# Lines are cached by (voice, speed, text) in /out/tts-cache, so re-runs
# only synthesize what changed.
import hashlib
import json
import os
import re
import sys

import numpy as np
import soundfile as sf

SPOT = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
CACHE = '/out/tts-cache'
VOICE = SPOT.get('voice', 'af_heart')
SPEED = float(SPOT.get('speed', 1.05))
LEAD = float(SPOT.get('lead', 0.35))   # scene start → first word
TAIL = float(SPOT.get('tail', 0.55))   # last word → scene end
SR = 24000
os.makedirs(CACHE, exist_ok=True)

_kokoro = None


def speak(text, speed):
    """Return mono float32 samples at 24 kHz for one line (cached)."""
    global _kokoro
    key = hashlib.sha1(f'{VOICE}|{speed}|{text}'.encode()).hexdigest()[:16]
    path = f'{CACHE}/{key}.wav'
    if os.path.exists(path):
        s, _ = sf.read(path, dtype='float32')
        return s
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro('/models/kokoro-v1.0.onnx', '/models/voices-v1.0.bin')
    s, sr = _kokoro.create(text, voice=VOICE, speed=speed, lang='en-us')
    assert sr == SR, sr
    # Trim Kokoro's leading/trailing near-silence so timing is tight.
    loud = np.where(np.abs(s) > 0.01)[0]
    if len(loud):
        s = s[max(0, loud[0] - int(0.03 * SR)): loud[-1] + int(0.08 * SR)]
    sf.write(path, s, SR)
    return s


def caption_chunks(text, start, dur, max_chars=44):
    """Split a line into short on-screen captions, timed by length."""
    words = text.split()
    chunks, cur = [], ''
    for w in words:
        nxt = f'{cur} {w}'.strip()
        if cur and (len(nxt) > max_chars or re.search(r'[.?!:]$', cur)):
            chunks.append(cur)
            cur = w
        else:
            cur = nxt
    if cur:
        chunks.append(cur)
    total = sum(len(c) for c in chunks)
    out, t = [], start
    for c in chunks:
        d = dur * len(c) / total
        out.append({'start': round(t, 3), 'end': round(t + d, 3), 'text': c})
        t += d
    return out


lines = []  # {start, dur, text}
timeline = {}
if SPOT.get('type') == 'tour':
    t = 0.0
    scenes = []
    for i, sc in enumerate(SPOT['scenes']):
        say = sc.get('say', '').strip()
        speech = speak(say, float(sc.get('speed', SPEED))) if say else np.zeros(0)
        sdur = len(speech) / SR
        dur = max(float(sc.get('min', 3.0)), LEAD + sdur + TAIL + float(sc.get('hold', 0)))
        if say:
            # "caption" overrides the on-screen text (e.g. a URL spelled out for the voice).
            lines.append({'start': t + LEAD, 'dur': sdur, 'text': sc.get('caption', say), 'audio': speech})
        scenes.append({'i': i, 'start': round(t, 3), 'end': round(t + dur, 3),
                       'voStart': round(t + LEAD, 3), 'voDur': round(sdur, 3)})
        t += dur
    ps = scenes[max(0, min(int(SPOT.get('posterScene', 1)), len(scenes) - 1))]
    poster = min(ps['end'] - 0.4, ps['start'] + float(SPOT.get('posterAt', 2.0)))
    timeline = {'duration': round(t, 3), 'scenes': scenes,
                'poster': round(max(ps['start'], poster), 3)}
else:
    dur = float(SPOT['duration'])
    items = sorted(SPOT.get('narration', []), key=lambda x: x['t'])
    for i, it in enumerate(items):
        speech = speak(it['say'], float(it.get('speed', SPEED)))
        sdur = len(speech) / SR
        end = items[i + 1]['t'] if i + 1 < len(items) else dur
        if it['t'] + sdur > end - 0.05:
            sys.exit(f'narration: "{it["say"]}" runs {sdur:.2f}s from {it["t"]}s, '
                     f'past {end}s. Shorten it or raise its "speed".')
        lines.append({'start': float(it['t']), 'dur': sdur, 'text': it.get('caption', it['say']), 'audio': speech})
    timeline = {'duration': dur}

total = timeline['duration']
vo = np.zeros(int(total * SR) + SR)
captions = []
for ln in lines:
    i = int(ln['start'] * SR)
    a = ln.pop('audio')
    vo[i:i + len(a)] += a[: len(vo) - i]
    captions += caption_chunks(ln['text'], ln['start'], ln['dur'])
vo = vo[: int(total * SR)]
sf.write(f'{OUT}/vo.wav', vo.astype(np.float32), SR)

timeline['lines'] = [{'start': round(l['start'], 3), 'dur': round(l['dur'], 3), 'text': l['text']}
                     for l in lines]
timeline['captions'] = captions
json.dump(timeline, open(f'{OUT}/timeline.json', 'w'), indent=1)


def ts(x):
    ms = int(round(x * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


with open(f'{OUT}/captions.srt', 'w') as f:
    for n, c in enumerate(captions, 1):
        f.write(f'{n}\n{ts(c["start"])} --> {ts(c["end"])}\n{c["text"]}\n\n')

speech_s = sum(l['dur'] for l in lines)
print(f'narration: {len(lines)} lines, {speech_s:.1f}s of speech in {total:.1f}s ({VOICE} @ {SPEED})')
