#!/usr/bin/env python3
"""Generate the 比邻云 proxima PWA icons.

We have no CJK font and no SVG rasterizer (no convert/rsvg/inkscape/sharp) on
this machine, so we draw a geometric location-pin mark instead of the glyph
比 — which fits the app's lat/lng/map identity anyway.

Output (into ../public, i.e. <repo>/public):
  pwa-192x192.png, pwa-512x512.png  — square, full-bleed gradient + centered pin
  apple-touch-icon.png              — 180x180, opaque (iOS applies its own mask)
  favicon.ico                       — multi-size ico

Design:
  - Full-bleed diagonal gradient  cyan #0ea5b7 → sea blue #2563eb (fills the
    whole square, so the maskable safe zone is fully covered).
  - Centered white pin (head circle + pointed tail) within the central ~80%.
  - A small accent dot in the pin head — a recognizable, brand-tinted mark.

Run once to (re)generate. The PNGs are committed alongside this script.
  python3 scripts/make_icons.py
"""
from __future__ import annotations
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public')

CYAN = (14, 165, 183)      # #0ea5b7 — app accent
BLUE = (37, 99, 235)       # #2563eb — app accent-2
WHITE = (255, 255, 255)
ACCENT_DOT = (14, 165, 183)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def gradient_bg(size: int) -> Image.Image:
    """Full-bleed diagonal gradient CYAN→BLUE covering the whole square."""
    img = Image.new('RGB', (size, size), CYAN)
    px = img.load()
    for y in range(size):
        for x in range(size):
            # Diagonal t across the square (0..1), biased from top-left CYAN
            # to bottom-right BLUE.
            t = (x + y) / (2 * (size - 1)) if size > 1 else 0
            px[x, y] = lerp(CYAN, BLUE, t)
    return img


def draw_pin(img: Image.Image):
    """Draw a centered white location pin with an accent dot in its head."""
    size = img.width
    cx = size / 2
    d = ImageDraw.Draw(img, 'RGBA')

    # Pin head: a circle centered slightly above middle.
    head_r = size * 0.20
    head_cy = size * 0.42
    d.ellipse(
        [cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r],
        fill=WHITE + (255,),
    )

    # Pin tail: a triangle pointing down from the bottom of the head to ~0.78
    # height, narrowing to a point. Drawn as a filled polygon.
    tail_top_y = head_cy + head_r * 0.62
    tail_point_y = size * 0.80
    half_w = head_r * 0.86
    d.polygon(
        [
            (cx - half_w, tail_top_y),
            (cx + half_w, tail_top_y),
            (cx, tail_point_y),
        ],
        fill=WHITE + (255,),
    )

    # Accent dot inside the head — brand tint, recognizable at small sizes.
    dot_r = head_r * 0.40
    d.ellipse(
        [cx - dot_r, head_cy - dot_r, cx + dot_r, head_cy + dot_r],
        fill=ACCENT_DOT + (255,),
    )


def render(size: int, path: str):
    img = gradient_bg(size).convert('RGBA')
    draw_pin(img)
    img.convert('RGB').save(path)  # opaque RGB; no transparency surprises on iOS


def main():
    os.makedirs(OUT, exist_ok=True)
    render(192, os.path.join(OUT, 'pwa-192x192.png'))
    render(512, os.path.join(OUT, 'pwa-512x512.png'))
    render(180, os.path.join(OUT, 'apple-touch-icon.png'))

    # Multi-size favicon.ico: include 16/32/48 for crispness across contexts.
    sizes = [16, 32, 48]
    icon_imgs = []
    for s in sizes:
        im = gradient_bg(s).convert('RGBA')
        draw_pin(im)
        icon_imgs.append(im.convert('RGB'))
    icon_imgs[0].save(
        os.path.join(OUT, 'favicon.ico'),
        format='ICO',
        sizes=[(s, s) for s in sizes],
        append_images=icon_imgs[1:],
    )

    for f in sorted(os.listdir(OUT)):
        if f.startswith(('pwa-', 'apple-touch-icon', 'favicon')):
            print('wrote', os.path.join(OUT, f))


if __name__ == '__main__':
    main()
