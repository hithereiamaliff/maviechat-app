"""Draws MavieChat's Google Play graphics from the app icon's shapes (scripts/app-icon/icon.json).

    python3 scripts/store-graphics/render.py   (needs numpy and Pillow, and `npm ci` for the Inter font)

Writes, into store/google-play:
- icon-512.png: the store icon, 512 x 512, the app icon itself. It stays a full square: Play rounds
  the corners itself.
- feature-graphic.png: 1024 x 500, opaque. The mark (the icon's M and speech bubble, without its
  square) beside the name, on the icon's teal, with one line under the name. No phone frame and no
  "free", "new" or "best", as Play's guidelines ask.

It never touches the app's own assets: scripts/app-icon/render.py writes those."""
import importlib.util
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Loading the icon's renderer must not leave a __pycache__ folder in the repository.
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'store', 'google-play')
FONTS = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'inter')

_spec = importlib.util.spec_from_file_location('app_icon', os.path.join(ROOT, 'scripts', 'app-icon', 'render.py'))
icon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(icon)

W, H = 1024, 500
NAME = 'MavieChat'
LINE = 'Chat with your own AI server'
# The mark's extent in the icon's 1024-unit design: the M's round-capped stroke down to the bubble's tail.
MARK = (232, 240, 792, 794)
MARK_HEIGHT = 250
GAP = 52
NAME_SIZE, LINE_SIZE, LINE_GAP = 100, 38, 26
LINE_COLOUR = '#CCFBF1'


def inter(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, weight, f'Inter_{weight}.ttf'), size)


def store_icon(design):
    image = icon.render_opaque(design, 512).convert('RGBA')
    image.save(os.path.join(OUT, 'icon-512.png'), optimize=True, icc_profile=icon.srgb_profile())


def feature_graphic(design):
    name_font, line_font = inter('700Bold', NAME_SIZE), inter('500Medium', LINE_SIZE)
    probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    _, name_top, name_right, _ = probe.textbbox((0, 0), NAME, font=name_font, anchor='ls')
    _, line_top, line_right, line_bottom = probe.textbbox((0, 0), LINE, font=line_font, anchor='ls')

    scale = MARK_HEIGHT / (MARK[3] - MARK[1])  # pixels per design unit
    mark_width = (MARK[2] - MARK[0]) * scale
    group = mark_width + GAP + max(name_right, line_right)
    mark_x, mark_y = (W - group) / 2, (H - MARK_HEIGHT) / 2

    # The icon's gradient, corner to corner, then the mark's layers.
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    t = np.clip((xs / W + ys / H) / 2, 0, 1)[..., None]
    out = icon.rgb(design['bg'][0]) * (1 - t) + icon.rgb(design['bg'][1]) * t
    ux, uy = (xs - mark_x) / scale + MARK[0], (ys - mark_y) / scale + MARK[1]
    for layer in design['layers']:
        out = out * (1 - (cov := icon.coverage(layer, ux, uy, scale))) + icon.rgb(layer['paint']) * cov
    image = Image.fromarray(np.round(out).astype(np.uint8), 'RGB')

    # The name and the line, as one block centred on the mark.
    block = -name_top + LINE_GAP - line_top + line_bottom
    name_baseline = (H - block) / 2 - name_top
    text_x = mark_x + mark_width + GAP
    draw = ImageDraw.Draw(image)
    draw.text((text_x, name_baseline), NAME, font=name_font, fill='#FFFFFF', anchor='ls')
    draw.text((text_x, name_baseline + LINE_GAP - line_top), LINE, font=line_font, fill=LINE_COLOUR, anchor='ls')
    image.save(os.path.join(OUT, 'feature-graphic.png'), optimize=True, icc_profile=icon.srgb_profile())


def main():
    os.makedirs(OUT, exist_ok=True)
    design = json.load(open(os.path.join(ROOT, 'scripts', 'app-icon', 'icon.json')))
    store_icon(design)
    feature_graphic(design)
    print('wrote store/google-play/icon-512.png and store/google-play/feature-graphic.png')


if __name__ == '__main__':
    main()
