#!/usr/bin/env python3
"""Synthesizes the clips ambience plays, into ../sounds.

Standard library only, and a fixed seed, so every run writes the same files:

    python3 -I ambience/scripts/make-sounds.py
"""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
PEAK = 0.7
FADE_S = 0.004
OUT = Path(__file__).resolve().parent.parent / "sounds"

random.seed(20261026)


def silence(seconds):
    return [0.0] * int(RATE * seconds)


def tone(freq, seconds, wave_fn, decay=None, attack=0.004, vibrato=0.0, end_freq=None):
    """One note: `wave_fn(phase)` over a period of 1, an attack, then an exponential
    decay (`decay` seconds to fall to 1/e) or a flat hold. `end_freq` glides the pitch."""
    n = int(RATE * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        f = freq if end_freq is None else freq * (end_freq / freq) ** (i / max(1, n - 1))
        if vibrato:
            f *= 1 + vibrato * math.sin(2 * math.pi * 5.5 * t)
        phase = (phase + f / RATE) % 1.0
        env = min(1.0, t / attack) if attack > 0 else 1.0
        if decay is not None:
            env *= math.exp(-t / decay)
        out.append(wave_fn(phase) * env)
    return out


def sine(p):
    return math.sin(2 * math.pi * p)


def triangle(p):
    return 4 * abs(p - 0.5) - 1


def harmonics(count, odd_only=False):
    """A band-limited square (odd harmonics) or saw (all), 1/n each: soft 8-bit."""
    ks = [k for k in range(1, count + 1) if not odd_only or k % 2 == 1]
    norm = sum(1 / k for k in ks)
    return lambda p: sum(math.sin(2 * math.pi * k * p) / k for k in ks) / norm


def mix(*tracks, offsets=None):
    offsets = offsets or [0.0] * len(tracks)
    length = max(int(RATE * o) + len(t) for t, o in zip(tracks, offsets))
    out = [0.0] * length
    for track, offset in zip(tracks, offsets):
        start = int(RATE * offset)
        for i, s in enumerate(track):
            out[start + i] += s
    return out


def finish(samples):
    peak = max(abs(s) for s in samples) or 1.0
    scaled = [s * PEAK / peak for s in samples]
    fade = int(RATE * FADE_S)
    for i in range(min(fade, len(scaled))):
        scaled[i] *= i / fade
        scaled[-1 - i] *= i / fade
    return scaled


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in finish(samples)))
    print(f"{path.name}: {len(samples) / RATE:.2f}s")


def click():
    # A key's tick: a burst of noise and a high blip, gone in a few milliseconds.
    n = int(RATE * 0.03)
    noise = [random.uniform(-1, 1) * math.exp(-(i / RATE) / 0.003) for i in range(n)]
    blip = tone(2400, 0.03, sine, decay=0.004, attack=0.0005)
    return mix([s * 0.6 for s in noise], blip)


def pop():
    # A bubble: a sine falling fast from 900 Hz to 280 Hz.
    return tone(900, 0.11, sine, decay=0.04, attack=0.002, end_freq=280)


def chime():
    # Two bell strikes a fifth apart, each with a quiet inharmonic partial.
    def bell(freq):
        return mix(
            tone(freq, 0.9, sine, decay=0.32),
            [s * 0.25 for s in tone(freq * 2.76, 0.9, sine, decay=0.12)],
            [s * 0.12 for s in tone(freq * 5.4, 0.9, sine, decay=0.06)],
        )

    return mix(bell(1046.5), bell(1568.0), offsets=[0.0, 0.09])


def fanfare():
    # C-E-G-C up, square-ish, the last note held with a little vibrato.
    sq = harmonics(5, odd_only=True)
    notes = [(523.25, 0.1), (659.25, 0.1), (783.99, 0.1), (1046.5, 0.42)]
    track = []
    for i, (f, d) in enumerate(notes):
        last = i == len(notes) - 1
        track += tone(f, d, sq, decay=0.3 if last else 0.12, vibrato=0.006 if last else 0.0)
        if not last:
            track += silence(0.015)
    return track


def fail():
    # The sad trombone: four notes sliding down, the last one wobbling.
    saw = harmonics(6)
    notes = [(233.08, 0.22), (220.0, 0.22), (207.65, 0.22), (196.0, 0.62)]
    track = []
    for i, (f, d) in enumerate(notes):
        last = i == len(notes) - 1
        note = tone(f, d, saw, attack=0.02, vibrato=0.03 if last else 0.0, end_freq=f * 0.97 if last else None)
        # Each note swells and fades ("wah").
        n = len(note)
        track += [s * math.sin(math.pi * min(1.0, (j / n) * (1.3 if last else 1.0))) ** 0.6 for j, s in enumerate(note)]
    return track


def commit():
    # Two notes up a fourth, triangle wave: done, saved.
    return tone(659.25, 0.09, triangle, decay=0.08) + silence(0.01) + tone(880.0, 0.24, triangle, decay=0.12)


if __name__ == "__main__":
    for name, make in [
        ("click", click),
        ("pop", pop),
        ("chime", chime),
        ("fanfare", fanfare),
        ("fail", fail),
        ("commit", commit),
    ]:
        write(name, make())
