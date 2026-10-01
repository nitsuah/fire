# Music + SFX for the fire Chaos-mode spot. 120 BPM, A minor.
# Usage: python3 synth.py <spot.json> <out.wav>
# The hook is a calm pad with a music-box line ("the plan"); the strike-through
# detunes it, and the groove drops on the Chaos click. Event callouts, the
# stat count, the dice roll and the picker click are scored in key.
import json
import sys
import wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SPOT = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
HOOK, CHAOS, PICK = SPOT['hook'], SPOT['chaos'], SPOT['pick']
SR = 44100
DUR = float(SPOT['duration'])
N = int(SR * DUR)
rng = np.random.default_rng(11)
BEAT = 0.5
CLICK = CHAOS['click']

def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)
def db(x): return 10 ** (x / 20)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)

def place(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i < 0: return
    s = sig[: len(buf) - i]
    buf[i:i + len(s)] += s * gain

def saw(f, n, harm=10, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, harm + 1):
        if f * k > 9000: break
        out += np.sin(2 * np.pi * f * k * t * (1 + detune)) / k
    return out

def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e

def pluck(f, dur=0.35, bright=4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, bright + 1):
        s += np.sin(2 * np.pi * f * k * t) * (0.55 ** (k - 1)) * np.exp(-t * (6 + 4 * k))
    s *= np.minimum(1, t / 0.003)
    return s

def bell(f, dur=1.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)
    return s * np.exp(-t * 3.2) * np.minimum(1, t / 0.002)

# Chords per 2s bar, bars aligned to the Chaos click: Am F C G
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]
BAR0 = CLICK % 2.0  # bar grid phase
def bar_at(t): return int(np.floor((t - BAR0) / 2.0)) % 4

music = np.zeros(N)
sfx = np.zeros(N)
kick_env = np.zeros(N)

# --- Pad: whole piece; dark and quiet in the hook, opens on the click ---
pad = np.zeros(N)
t0 = BAR0 - 2.0
while t0 < DUR:
    n = int(2.6 * SR)
    ch = CHORDS[bar_at(t0 + 0.01)]
    v = np.zeros(n)
    for m in ch:
        for d in (-0.004, 0.0, 0.004):
            v += saw(hz(m), n, harm=8, detune=d)
    v *= env_adsr(n, 0.45, 0.8)
    place(pad, v, max(t0 - 0.2, 0), 1.0)
    t0 += 2.0
tt = np.arange(N) / SR
x = np.clip((tt - CLICK) / 0.8, 0, 1)
pad = lp(pad, 650) * (1 - x) + lp(pad, 2300) * x
music += pad * db(-28)

# --- Hook: music-box "plan" melody, detuned by the strike ---
STRIKE = HOOK['strike']
melody = [69, 72, 76, 74, 72, 76, 79, 77]
for i, m in enumerate(melody):
    st = 0.2 + i * 0.28
    if st >= STRIKE: break
    place(music, bell(hz(m + 12), 1.0), st, db(-26))
# Strike: a pitch-dropping "tape stop" + a dissonant cluster
n = int(0.7 * SR)
ts = np.arange(n) / SR
f = hz(81) * np.exp(-ts * 2.2)
tape = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-ts * 3)
place(sfx, tape, STRIKE, db(-22))
for m in (58, 64, 65):  # Bb E F against A minor
    place(sfx, bell(hz(m + 12), 1.4), STRIKE + 0.03, db(-28))
# Riser into the reveal, cut on the click
nr = int((CLICK - 3.2) * SR)
r = np.linspace(0, 1, nr)
noise = rng.standard_normal(nr)
place(sfx, (bp(noise, 300, 1200) * (1 - r) + bp(noise, 2000, 7000) * r) * r ** 2.2, 3.2, db(-28))

# --- Groove from the click to the outro ---
def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 75 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) + 0.15 * lp(rng.standard_normal(n), 1800) * np.exp(-t * 60)
END = 18.5
kicks = [CLICK + i * BEAT for i in range(int((END - CLICK) / BEAT))] + [END + i * 1.0 for i in range(3)]
for kt in kicks:
    place(music, kick(), kt, db(-9))
    place(kick_env, np.exp(-np.arange(int(0.3 * SR)) / SR * 9), kt, 1.0)
duck = 1 - 0.55 * np.clip(kick_env, 0, 1)

bass = np.zeros(N)
t = CLICK
while t < END + 1.5:
    fb = hz(ROOTS[bar_at(t)])
    n = int(0.24 * SR)
    tb = np.arange(n) / SR
    s = (np.sin(2 * np.pi * fb * tb) + 0.35 * np.sin(4 * np.pi * fb * tb)) * np.exp(-tb * 7) * np.minimum(1, tb / 0.005)
    place(bass, s, t, 1.0)
    t += BEAT / 2
music += lp(bass, 600) * db(-13)

for i in range(int((END - (CLICK + 0.5)) / BEAT)):
    n = int(0.05 * SR)
    h = hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * 90)
    place(music, h, CLICK + 0.5 + i * BEAT + BEAT / 2, db(-31))

arp = np.zeros(N)
t = 8.5; k = 0
while t < END - 1e-6:
    ch = CHORDS[bar_at(t)]
    m = ch[k % len(ch)] + 12 + (12 if k % 8 >= 6 else 0)
    place(arp, pluck(hz(m), 0.3, 3), t, 1.0)
    t += BEAT / 2; k += 1
music += lp(arp, 3500) * db(-28)
music *= duck

# --- SFX ---
def whoosh(length=0.6):
    n = int(length * SR)
    w = np.linspace(0, 1, n)
    nz = rng.standard_normal(n)
    return (bp(nz, 300, 1200) * (1 - w) + bp(nz, 1500, 5000) * w) * np.sin(np.pi * w) ** 2
for tc in (3.5, 8.5, 12.0, 15.5, 18.5):
    place(sfx, whoosh(0.55), tc - 0.4, db(-25))

def click(m):
    n = int(0.03 * SR)
    c = bp(rng.standard_normal(n), 1500, 4000) * np.exp(-np.arange(n) / SR * 200) * 0.6
    s = pluck(hz(m), 0.3, 2)
    s[:n] += c
    return s

def impact(root_midi):
    n = int(1.6 * SR)
    t_ = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(root_midi - 12) * t_) * np.exp(-t_ * 3)
    for m in (root_midi, root_midi + 7, root_midi + 12, root_midi + 15):
        s += 0.3 * np.sin(2 * np.pi * hz(m) * t_) * np.exp(-t_ * 2.2)
    return s * np.minimum(1, t_ / 0.004)

# Chaos click: click + impact + a short gust of wind
place(sfx, click(69), CLICK - 0.02, db(-20))
place(sfx, impact(45), CLICK, db(-15))
n = int(1.1 * SR)
g = np.linspace(0, 1, n)
gust = bp(rng.standard_normal(n), 500, 3000) * np.sin(np.pi * g) ** 1.5 * (1 + 0.4 * np.sin(2 * np.pi * 5 * g))
place(sfx, gust, CLICK, db(-27))

# Callouts: pentatonic plucks, down events step down, up events step up
PENTA = [69, 72, 74, 76, 79, 81]
for i in range(len(CHAOS['pops'])):
    m = PENTA[(i * 2) % len(PENTA)] + (0 if i % 2 else 12)
    place(sfx, pluck(hz(m), 0.4, 3), CHAOS['popStart'] + i * CHAOS['popStep'], db(-21))

# Stat count-up ticks (9.6–10.5), landing on a low A
for i in range(12):
    place(sfx, pluck(hz(81 - [0, 2, 4, 5, 7, 9][i % 6]), 0.08, 2), 9.6 + i * 0.075, db(-34))
place(sfx, bell(hz(57), 1.2), 10.5, db(-24))

# Chips wipe + dice roll
place(sfx, whoosh(0.9), 12.8, db(-31))
for i in range(7):
    nn = int(0.025 * SR)
    place(sfx, bp(rng.standard_normal(nn), 1200, 4500) * np.exp(-np.arange(nn) / SR * 160), 14.0 + i * 0.08 + 0.01 * i * i, db(-27))
place(sfx, pluck(hz(76), 0.35, 2), 14.62, db(-22))

# Picker pop + Add click
place(sfx, pluck(hz(81), 0.3, 2), 16.25, db(-24))
place(sfx, click(72), PICK['click'], db(-20))
place(sfx, pluck(hz(84), 0.5, 2), PICK['click'] + 0.08, db(-25))

# Outro: logo impact + URL chime
place(sfx, impact(45), 18.55, db(-16))
place(sfx, pluck(hz(76), 0.6, 2), 19.6, db(-23))
place(sfx, pluck(hz(81), 0.8, 2), 19.67, db(-23))

# --- Shared room + bus ---
def reverb(x, secs=1.8, seed=1):
    r_ = np.random.default_rng(seed)
    n = int(secs * SR)
    ir = r_.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / secs))
    ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
    return fftconvolve(x, ir)[: len(x)]

dry = music + sfx
L = dry + 0.22 * reverb(music, seed=1) + 0.32 * reverb(sfx, seed=3)
R = dry + 0.22 * reverb(music, seed=2) + 0.32 * reverb(sfx, seed=4)
st = np.stack([L, R], 1)
st = hp(st.T, 30).T
st = st / np.max(np.abs(st)) * 0.9
st = np.tanh(st) / np.tanh(0.9)
fade = np.ones(N); nf = int(0.8 * SR); fade[-nf:] = np.linspace(1, 0, nf) ** 2
fin = np.ones(N); fin[:220] = np.linspace(0, 1, 220)
st *= (fade * fin)[:, None]
st *= db(-1.0) / np.max(np.abs(st))
pcm = (st * 32767).astype(np.int16)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', pcm.shape)
