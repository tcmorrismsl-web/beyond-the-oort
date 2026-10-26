#!/usr/bin/env python3
"""
Generates the app icon: a small, simple solar system (a warm sun and a few
thin orbits) wrapped in a faint, speckled shell of comets: the Oort Cloud.

Run from the repo root:  python3 tools/make-icon.py
Writes public/icons/icon-512.png, icon-192.png, apple-touch-icon.png.
Deterministic (seeded), so re-running gives the same pixels.

The sun and orbits sit well inside the central 80% circle, so the icon
survives iOS rounded corners; only the cloud's outer edge reaches past it.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

S = 2048  # draw big, downsample for smooth edges
C = S / 2
OUT = 'public/icons'
rng = random.Random(1950)  # Oort's 1950 paper


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def background():
    """Deep space: near-black edges, a hint of blue toward the middle."""
    img = Image.new('RGB', (S, S))
    px = img.load()
    inner, outer = (16, 26, 48), (4, 6, 12)
    for y in range(S):
        for x in range(S):
            d = min(1.0, math.hypot(x - C, y - C) / (S * 0.72))
            px[x, y] = lerp(inner, outer, d ** 0.8)
    return img.convert('RGBA')


def glow(radius, color, blur):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([C - radius, C - radius, C + radius, C + radius], fill=color)
    return layer.filter(ImageFilter.GaussianBlur(blur))


def oort_cloud():
    """A subtle shell of tiny icy points: densest at its edge and thinning inward, like a sphere seen from far away."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r_edge = S * 0.43
    for _ in range(2600):
        r = r_edge - abs(rng.gauss(0, S * 0.035))
        phi = rng.uniform(0, math.tau)
        x, y = C + r * math.cos(phi), C + r * math.sin(phi)
        size = rng.choice([2, 2, 3, 3, 4])
        a = rng.randint(45, 135)
        tint = rng.choice([(190, 215, 255), (170, 200, 245), (215, 230, 255)])
        d.ellipse([x - size, y - size, x + size, y + size], fill=tint + (a,))
    # A faint haze along the shell so it reads as a cloud, not just dots.
    haze = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(haze)
    hd.ellipse([C - r_edge, C - r_edge, C + r_edge, C + r_edge], outline=(130, 170, 235, 55), width=int(S * 0.055))
    haze = haze.filter(ImageFilter.GaussianBlur(S * 0.025))
    return Image.alpha_composite(haze, layer)


def solar_system():
    """Three thin orbits on a gentle tilt, three little planets, one warm sun."""
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tilt = 0.4  # vertical squash of the orbits
    orbits = [(S * 0.12, (140, 205, 255, 160), 0.6), (S * 0.195, (140, 205, 255, 130), 3.9), (S * 0.28, (140, 205, 255, 105), 2.2)]
    w = max(8, S // 180)
    for rx, color, _ in orbits:
        d.ellipse([C - rx, C - rx * tilt, C + rx, C + rx * tilt], outline=color, width=w)
    planets = [((140, 210, 255), S * 0.024), ((255, 196, 120), S * 0.032), ((200, 170, 255), S * 0.022)]
    for (rx, _, ang), (pc, pr) in zip(orbits, planets):
        x, y = C + rx * math.cos(ang), C + rx * tilt * math.sin(ang)
        d.ellipse([x - pr, y - pr, x + pr, y + pr], fill=pc + (255,))
    return layer


def main():
    img = background()
    img = Image.alpha_composite(img, oort_cloud())
    img = Image.alpha_composite(img, glow(S * 0.13, (255, 170, 70, 85), S * 0.05))  # sun's light
    img = Image.alpha_composite(img, solar_system())
    img = Image.alpha_composite(img, glow(S * 0.055, (255, 214, 140, 255), S * 0.007))  # the sun
    img = Image.alpha_composite(img, glow(S * 0.03, (255, 246, 220, 255), S * 0.005))  # hot core
    final = img.convert('RGB')
    for name, size in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
        final.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', optimize=True)
    print('icons written')


if __name__ == '__main__':
    main()
