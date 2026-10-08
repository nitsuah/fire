# Music bed + SFX for narrated tour spots, any length.
# Usage: python3 bed.py <spot.json> <timeline.json> <out.wav>
# 120 BPM, A minor (Am F C G, two bars per chord), kept sparse so it sits
# under the voice; pipeline.sh ducks it further against vo.wav. Whooshes
# land on scene cuts, clicks on the cursor clicks, an impact on the outro.
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SPOT = json.load(open(sys.argv[1]))
TL = json.load(open(sys.argv[2]))
OUT = sys.argv[3]
SR = 44100
DUR = float(TL['duration'])
N = int(SR * DUR)
rng = np.random.default_rng(11)
BEAT = 0.5
BAR = 2.0


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def db(x): return 10 ** (x / 20)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)


def place(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i < 0: return
    s = sig[: len(buf) - i]
    buf[i:i + len(s)] += s * gain


def saw(f, n, harm=8, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, harm + 1):
        if f * k > 9000: break
        out += np.sin(2 * np.pi * f * k * t * (1 + detune)) / k
    return out


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def pluck(f, dur=0.35, bright=3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, bright + 1):
        s += np.sin(2 * np.pi * f * k * t) * (0.55 ** (k - 1)) * np.exp(-t * (6 + 4 * k))
    return s * np.minimum(1, t / 0.003)


CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]
CH = 2 * BAR  # seconds per chord
scenes = TL['scenes']
kinds = [s['kind'] for s in SPOT['scenes']]
groove_on = scenes[1]['start'] if len(scenes) > 1 else 0.0
outro_t = next((sc['start'] for sc, k in zip(scenes, kinds) if k == 'outro'), DUR)

music = np.zeros(N)
sfx = np.zeros(N)

# Pad over everything, opening up once the groove starts.
pad = np.zeros(N)
nch = int(np.ceil(DUR / CH)) + 1
for c in range(nch):
    n = int((CH + 0.8) * SR)
    v = np.zeros(n)
    for m in CHORDS[c % 4]:
        for d in (-0.004, 0.0, 0.004):
            v += saw(hz(m), n, detune=d)
    v *= env(n, 0.6, 0.9)
    place(pad, v, c * CH - (0.3 if c else 0))
x = np.clip((np.arange(N) / SR - groove_on + 0.5) / 2.0, 0, 1)
pad = lp(pad, 650) * (1 - x) + lp(pad, 1800) * x
music += pad * db(-29)

# Half-time kick (beats 1 and 3) from the groove until the outro.
kick_env = np.zeros(N)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 70 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)


t = groove_on
while t < outro_t - 0.01:
    place(music, kick(), t, db(-13))
    place(kick_env, np.exp(-np.arange(int(0.3 * SR)) / SR * 9), t)
    t += 2 * BEAT

# Bass: quarter-note pulse on the root.
bass = np.zeros(N)
t = groove_on
while t < outro_t - 0.01:
    f = hz(ROOTS[int(t // CH) % 4])
    n = int(0.42 * SR)
    tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 5) * np.minimum(1, tt / 0.006)
    place(bass, s, t)
    t += BEAT
music += lp(bass, 500) * db(-17)

# Offbeat hats and a sparse arpeggio, both quiet.
t = groove_on
while t < outro_t - 0.01:
    n = int(0.04 * SR)
    place(music, hp(rng.standard_normal(n), 7500) * np.exp(-np.arange(n) / SR * 100), t + BEAT / 2, db(-36))
    t += BEAT
arp = np.zeros(N)
t, k = groove_on, 0
while t < outro_t - 0.01:
    ch = CHORDS[int(t // CH) % 4]
    if k % 4 != 3:
        place(arp, pluck(hz(ch[k % len(ch)] + 12), 0.4), t)
    t += BEAT; k += 1
music += lp(arp, 3000) * db(-31)
music *= 1 - 0.4 * np.clip(kick_env, 0, 1)


def whoosh(length=0.6):
    n = int(length * SR)
    tt = np.linspace(0, 1, n)
    noise = rng.standard_normal(n)
    return (bp(noise, 300, 1200) * (1 - tt) + bp(noise, 1500, 5000) * tt) * np.sin(np.pi * tt) ** 2


for sc in scenes[1:]:
    place(sfx, whoosh(0.55), sc['start'] - 0.4, db(-27))


def click(m):
    n = int(0.03 * SR)
    c = bp(rng.standard_normal(n), 1500, 4000) * np.exp(-np.arange(n) / SR * 200) * 0.6
    s = pluck(hz(m), 0.3, 2)
    s[:n] += c
    return s


for sc, S in zip(SPOT['scenes'], scenes):
    cl = sc.get('clicks') or ([sc['click']] if sc.get('click') else [])
    for i, c in enumerate(cl):
        place(sfx, click([64, 69, 72, 76][i % 4]), S['start'] + c['at'] * (S['end'] - S['start']), db(-22))


def impact(root):
    n = int(2.0 * SR)
    t_ = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(root - 12) * t_) * np.exp(-t_ * 2.5)
    for m in (root, root + 7, root + 12, root + 15):
        s += 0.3 * np.sin(2 * np.pi * hz(m) * t_) * np.exp(-t_ * 1.8)
    return s * np.minimum(1, t_ / 0.004)


if outro_t < DUR:
    place(sfx, impact(45), outro_t + 0.05, db(-18))
    place(sfx, pluck(hz(76), 0.6, 2), outro_t + 1.05, db(-25))
    place(sfx, pluck(hz(81), 0.8, 2), outro_t + 1.12, db(-25))


def reverb(x, secs=1.8, seed=1):
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / secs))
    ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
    return fftconvolve(x, ir)[: len(x)]


dry = music + sfx
L = dry + 0.22 * reverb(music, seed=1) + 0.3 * reverb(sfx, seed=3)
R = dry + 0.22 * reverb(music, seed=2) + 0.3 * reverb(sfx, seed=4)
st = hp(np.stack([L, R], 1).T, 30).T
st = st / np.max(np.abs(st)) * 0.9
st = np.tanh(st) / np.tanh(0.9)
fade = np.ones(N); nf = int(1.2 * SR); fade[-nf:] = np.linspace(1, 0, nf) ** 2
fade[:220] = np.linspace(0, 1, 220)
st *= fade[:, None]
st *= db(-1.0) / np.max(np.abs(st))
pcm = (st * 32767).astype(np.int16)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('bed ok', f'{DUR:.1f}s')
