#!/usr/bin/env python3
"""Generate the 比邻云 proxima PWA icons.

Redesign (2026): replaces the plain cylindrical pin with a STAR-MARK —
a four-pointed star (proxima = nearest star) nested in a thin orbital ring,
on a cyan→sea-blue diagonal field. Reads as "a star + a location" at all
sizes, matching the new map-first identity.

Output (into ../public, i.e. <repo>/public):
  pwa-192x192.png, pwa-512x512.png  — square, full-bleed gradient + star-mark
  apple-touch-icon.png              — 180x180, opaque
  favicon.ico                       — multi-size ico

Design:
  - Full-bleed diagonal gradient  cyan #0ea5b7 → sea blue #2563eb.
  - Star-mark centered within ~80% safe area (maskable-friendly).
  - Mark is a white four-pointed star with a thin white ring around it, the
    two shapes sharing a soft drop-shadow so the mark reads consistently from
    16px favicon all the way to 512px store listing.
  - An optional tiny comet-tail curve from bottom-left adds movement and
    doubles as the location pin's directional cue.

Run once to (re)generate. The PNGs are committed alongside this script.
  python3 scripts/make_icons.py
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public')

CYAN = (14, 165, 183)       # #0ea5b7 — app accent
BLUE = (37, 99, 235)        # #2563eb — app accent-2
WHITE = (255, 255, 255)
SHADOW = (8, 40, 80)        # deep blue-grey shadow tint


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def gradient_bg(size: int) -> Image.Image:
    """Full-bleed diagonal gradient CYAN→BLUE, slightly biased so the top
    starts brighter (reads as daylight glow, matches the app's 晴空白蓝)."""
    img = Image.new('RGB', (size, size), CYAN)
    px = img.load()
    for y in range(size):
        for x in range(size):
            # Diagonal progress 0..1 biased toward CYAN at top-left.
            t = ((x * 1.1) + y) / (2.1 * (size - 1)) if size > 1 else 0
            px[x, y] = lerp(CYAN, BLUE, min(1.0, t))
    return img


def star_points(cx: float, cy: float, R: float, r: float, n: int = 4, phase: float = -math.pi / 2):
    """n-pointed star with outer radius R and inner radius r. phase -pi/2 puts
    a point straight up."""
    pts = []
    for i in range(2 * n):
        rr = R if i % 2 == 0 else r
        ang = phase + i * math.pi / n
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    return pts


def draw_mark(img: Image.Image):
    """Draw the star + orbital ring + comet arc at the center of img."""
    size = img.width
    cx = size / 2
    cy = size / 2
    # Mark bounding box is 62% of the canvas (comfortably within the maskable
    # 80% safe zone).
    R = size * 0.335  # outer star radius
    r = R * 0.42      # inner star radius (controls pointiness)

    # Work on a supersampled transparent layer for crisp antialiasing, then
    # downscale back. 4x is the sweet spot for simple flat shapes.
    SS = 4
    W = size * SS
    layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    cxS = W / 2
    cyS = W / 2
    RS = R * SS
    rS = r * SS * 0.55  # sharper star points for a more recognizable silhouette
    ring_width = max(2, int(W * 0.030))
    shadow_blur = max(2, int(W * 0.030))
    shadow_offset_y = max(2, int(W * 0.016))

    # --- shadow pass: render the star+ring slightly darker, offset + blur ---
    shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    star = star_points(cxS, cyS + shadow_offset_y, RS, rS)
    sd.polygon(star, fill=SHADOW + (200,))
    # Shadow ring
    ring_bb = [cxS - RS * 1.14, cyS + shadow_offset_y - RS * 1.14, cxS + RS * 1.14, cyS + shadow_offset_y + RS * 1.14]
    sd.ellipse(ring_bb, outline=SHADOW + (170,), width=ring_width)
    shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_blur))
    layer.alpha_composite(shadow)

    # --- comet arc: subtle luminous swoosh trailing bottom-left ---
    arc_bb = [cxS - RS * 1.9, cyS + RS * 0.5, cxS - RS * 0.1, cyS + RS * 1.6]
    arc_w = max(2, int(W * 0.030))
    d.arc(arc_bb, start=115, end=230, fill=WHITE + (180,), width=arc_w)

    # --- orbital ring: bold and crisp ---
    ring_bb = [cxS - RS * 1.12, cyS - RS * 1.12, cxS + RS * 1.12, cyS + RS * 1.12]
    ring_width = max(3, int(W * 0.034))
    d.ellipse(ring_bb, outline=WHITE + (242,), width=ring_width)

    # --- star (crisp white) ---
    star = star_points(cxS, cyS, RS, rS)
    d.polygon(star, fill=WHITE + (255,))

    # --- luminous core: small dot at the star's center so the pin read isn't
    # lost at tiny sizes. Uses the accent cyan to tie back to the brand. ---
    dot_R = RS * 0.16
    d.ellipse(
        [cxS - dot_R, cyS - dot_R, cxS + dot_R, cyS + dot_R],
        fill=CYAN + (255,),
    )

    # Commit: composite the layer onto the gradient.
    img.paste(layer.resize((size, size), Image.LANCZOS).convert('RGBA'), (0, 0), layer.resize((size, size), Image.LANCZOS))


def render(size: int, path: str):
    img = gradient_bg(size).convert('RGBA')
    draw_mark(img)
    img.convert('RGB').save(path)  # opaque RGB — no transparency surprises on iOS


def main():
    os.makedirs(OUT, exist_ok=True)
    render(192, os.path.join(OUT, 'pwa-192x192.png'))
    render(512, os.path.join(OUT, 'pwa-512x512.png'))
    render(180, os.path.join(OUT, 'apple-touch-icon.png'))

    # Multi-size favicon.ico: 16/32/48 for crispness across contexts.
    sizes = [16, 32, 48]
    icon_imgs = []
    for s in sizes:
        im = gradient_bg(s).convert('RGBA')
        draw_mark(im)
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
