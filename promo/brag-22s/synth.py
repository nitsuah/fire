# Music + SFX for the fire 22s spot. 120 BPM, A minor.
# Usage: python3 synth.py <spot.json> <out.wav>
# Scene cuts sit on the bar (2s); hook timings come from spot.json so the
# counter ticks stay locked to the on-screen count-up.
import json
import sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave

SPOT = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
HOOK = SPOT['hook']
SR = 44100
DUR = float(SPOT['duration'])
N = int(SR * DUR)
rng = np.random.default_rng(7)
BEAT = 0.5

def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)
def db(x): return 10 ** (x / 20)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)

def place(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf): return
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

# Chords per 2s bar: Am F C G (midi)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]

music = np.zeros(N)
sfx = np.zeros(N)
kick_env = np.zeros(N)  # for sidechain

# --- Pad (whole piece), filtered darker during hook ---
pad = np.zeros(N)
for bar in range(11):
    t0 = bar * 2.0
    n = int(2.6 * SR)
    ch = CHORDS[bar % 4]
    if bar == 10: ch = CHORDS[0]
    v = np.zeros(n)
    for m in ch:
        for d in (-0.004, 0.0, 0.004):
            v += saw(hz(m), n, harm=8, detune=d)
    v *= env_adsr(n, 0.45, 0.8)
    place(pad, v, t0 - 0.2 if bar else 0, 1.0)
pad_hook = lp(pad, 700)
pad_open = lp(pad, 2200)
x = np.clip((np.arange(N) / SR - 1.1) / 1.9, 0, 1)  # opens up from the answer to the reveal
pad = pad_hook * (1 - x) + pad_open * x
pad *= 0.5 + 0.5 * np.clip((np.arange(N) / SR - 1.25) / 0.3, 0, 1)
music += pad * db(-27)

# --- Kick: four on the floor 3.0–18.5, half time in outro ---
def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 75 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 11) + 0.15 * lp(rng.standard_normal(n), 1800) * np.exp(-t * 60)
kicks = [3.0 + i * BEAT for i in range(31)] + [18.5 + i * 1.0 for i in range(3)]
for kt in kicks:
    place(music, kick(), kt, db(-9))
    place(kick_env, np.exp(-np.arange(int(0.3 * SR)) / SR * 9), kt, 1.0)
duck = 1 - 0.55 * np.clip(kick_env, 0, 1)

# --- Bass: 8th-note pulse on root from 3.0 ---
bass = np.zeros(N)
t = 3.0
while t < 20.0:
    bar = int(t // 2) % 4
    f = hz(ROOTS[bar] - 12 + 12)  # A2 region
    n = int(0.24 * SR)
    tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 7) * np.minimum(1, tt / 0.005)
    place(bass, s, t, 1.0)
    t += BEAT / 2
bass = lp(bass, 600)
music += bass * db(-13)

# --- Hats: offbeat 8ths 7.0–18.5 ---
for i in range(int((18.5 - 7.0) / BEAT)):
    n = int(0.05 * SR)
    h = hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * 90)
    place(music, h, 7.0 + i * BEAT + BEAT / 2, db(-31))

# --- Arp: 8th-note chord tones, octave up, 7.0–18.5 ---
arp = np.zeros(N)
t = 7.0; k = 0
while t < 18.5 - 1e-6:
    bar = int(t // 2) % 4
    ch = CHORDS[bar]
    m = ch[k % len(ch)] + 12 + (12 if k % 8 >= 6 else 0)
    place(arp, pluck(hz(m), 0.3, 3), t, 1.0)
    t += BEAT / 2; k += 1
music += lp(arp, 3500) * db(-27)

music *= duck

# --- SFX (in key, same room) ---
def tick(level=-34):
    n = int(0.018 * SR)
    s = bp(rng.standard_normal(n), 2500, 6000) * np.exp(-np.arange(n) / SR * 260)
    return s * db(level)
for i, ch in enumerate('When can I retire?'):
    if ch != ' ': place(sfx, tick(), 0.15 + i * 0.05)
for i, ch in enumerate('how close am I to FIRE?'):
    if ch != ' ': place(sfx, tick(-37), 15.5 + i * 0.03)

def whoosh(length=0.6, up=True):
    n = int(length * SR)
    tt = np.linspace(0, 1, n)
    noise = rng.standard_normal(n)
    # sweep a band by blending two filtered copies
    lo, hi = bp(noise, 300, 1200), bp(noise, 1500, 5000)
    mix = lo * (1 - tt) + hi * tt if up else lo * tt + hi * (1 - tt)
    return mix * np.sin(np.pi * tt) ** 2
for tt in (3.0, 7.0, 11.0, 15.0, 18.5):
    place(sfx, whoosh(0.55), tt - 0.4, db(-24))

def impact(root_midi):
    n = int(1.6 * SR)
    t_ = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(root_midi - 12) * t_) * np.exp(-t_ * 3)
    for m in (root_midi, root_midi + 7, root_midi + 12, root_midi + 15):
        s += 0.3 * np.sin(2 * np.pi * hz(m) * t_) * np.exp(-t_ * 2.2)
    return s * np.minimum(1, t_ / 0.004)
# Hook: the age counter races up (one tick per number, climbing the
# A minor scale), a noise riser swells under it, and "??" lands on an
# unresolved chord. The groove at the reveal (3.0s) is the resolution.
cs, ce, a0, a1 = HOOK['countStart'], HOOK['countEnd'], HOOK['from'], HOOK['to']
SCALE_AM = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76]
steps = a1 - a0
for i in range(1, steps + 1):
    tk = cs + (i / steps) ** (1 / 2.2) * (ce - cs)
    m = SCALE_AM[min(len(SCALE_AM) - 1, int(i / steps * len(SCALE_AM)))] + 12
    place(sfx, pluck(hz(m), 0.09, 2), tk, db(-33 + 7 * i / steps))
nr = int((ce - cs + 0.1) * SR)
tr = np.linspace(0, 1, nr)
noise = rng.standard_normal(nr)
riser = (bp(noise, 400, 1500) * (1 - tr) + bp(noise, 2000, 7000) * tr) * tr ** 2
place(sfx, riser, cs, db(-27))

def chord_hit(notes, bass_midi, decay=2.4):
    n = int(1.6 * SR)
    t_ = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(bass_midi) * t_) * np.exp(-t_ * 3)
    for m in notes:
        s += 0.3 * np.sin(2 * np.pi * hz(m) * t_) * np.exp(-t_ * decay)
    return s * np.minimum(1, t_ / 0.004)
place(sfx, chord_hit([53, 59, 64], 41), ce, db(-17))  # "??" : F + B + E, left hanging
place(sfx, impact(45), 18.55, db(-16)) # logo
# URL lands: a soft two-note chime (E5 + A5)
place(sfx, pluck(hz(76), 0.6, 2), 19.55, db(-23))
place(sfx, pluck(hz(81), 0.8, 2), 19.62, db(-23))

# Row pops: A minor pentatonic, ascending
for i, m in enumerate([69, 72, 74, 76, 79]):
    place(sfx, pluck(hz(m), 0.4, 3), 7.45 + i * 0.28, db(-21))
# Malibu: a little two-note shrug (E5 -> C5)
place(sfx, pluck(hz(76), 0.25, 2), 9.0, db(-19))
place(sfx, pluck(hz(72), 0.45, 2), 9.14, db(-19))

# Clicks: soft click + tonal blip
def click(m):
    n = int(0.03 * SR)
    c = bp(rng.standard_normal(n), 1500, 4000) * np.exp(-np.arange(n) / SR * 200) * 0.6
    s = pluck(hz(m), 0.3, 2)
    s[:n] += c
    return s
place(sfx, click(64), 12.15, db(-20))
place(sfx, click(69), 13.65, db(-20))
# Tool call + JSON lines
place(sfx, pluck(hz(81), 0.35, 2), 16.35, db(-22))
for i in range(7):
    place(sfx, pluck(hz([69, 72, 76, 79, 81, 84, 81][i]), 0.18, 1), 16.6 + i * 0.09, db(-31))

# --- Shared room ---
def reverb(x, secs=1.8, seed=1):
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / secs))
    ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
    return fftconvolve(x, ir)[: len(x)]

dry = music + sfx
L = dry + 0.22 * reverb(music, seed=1) + 0.32 * reverb(sfx, seed=3)
R = dry + 0.22 * reverb(music, seed=2) + 0.32 * reverb(sfx, seed=4)
st = np.stack([L, R], 1)
st = hp(st.T, 30).T
# gentle bus glue + limiter-ish soft clip
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
