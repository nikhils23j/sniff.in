"""Generates Sniff.in app icon / splash / adaptive-icon PNGs from the brand mark (deck slide icon).

Run: python3 -I scripts/generate-brand-assets.py
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "images")
INDIGO = (58, 46, 128, 255)   # #3A2E80
TEAL = (34, 199, 194, 255)    # #22C7C2
WHITE = (255, 255, 255, 255)
BRAND_TEAL = (19, 196, 184, 255)  # #13C4B8 (palette.teal500)
SS = 4  # supersampling factor for smooth arcs


def draw_mark(size, scale=1.0, mono=None, left=None, right=None):
    """Radio-wave mark: white dot, two white arcs left, three teal arcs right.

    `left`/`right` override the left (dot + arcs) and right (arcs) colours, e.g. for the light splash."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    u = S * scale
    stroke = int(0.058 * u)
    dot = 0.062 * u
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=mono or left or WHITE)
    for r, color, (a0, a1) in [
        (0.17, mono or left or WHITE, (140, 220)),
        (0.27, mono or left or WHITE, (135, 225)),
        (0.17, mono or right or TEAL, (-40, 40)),
        (0.27, mono or right or TEAL, (-45, 45)),
        (0.37, mono or right or TEAL, (-50, 50)),
    ]:
        R = r * u
        d.arc([c - R, c - R, c + R, c + R], start=a0, end=a1, fill=color, width=stroke)
    return img.resize((size, size), Image.LANCZOS)


def solid(size, color):
    return Image.new("RGBA", (size, size), color)


def main():
    os.makedirs(OUT, exist_ok=True)
    icon = solid(1024, INDIGO)
    icon.alpha_composite(draw_mark(1024, 0.95))
    icon.convert("RGB").save(os.path.join(OUT, "icon.png"))
    # Android adaptive icon: keep the mark inside the 66% safe zone.
    draw_mark(1024, 0.62).save(os.path.join(OUT, "android-icon-foreground.png"))
    solid(1024, INDIGO).save(os.path.join(OUT, "android-icon-background.png"))
    draw_mark(1024, 0.62, mono=WHITE).save(os.path.join(OUT, "android-icon-monochrome.png"))
    draw_mark(512, 1.0).save(os.path.join(OUT, "splash-icon.png"))
    # Light splash (cream background): indigo left arcs + dot, brand teal right arcs.
    draw_mark(512, 1.0, left=INDIGO, right=BRAND_TEAL).save(os.path.join(OUT, "splash-icon-light.png"))
    fav = solid(48, INDIGO)
    fav.alpha_composite(draw_mark(48, 0.95))
    fav.save(os.path.join(OUT, "favicon.png"))
    print("Brand assets written to", OUT)


if __name__ == "__main__":
    sys.exit(main())
