"""Draws MavieChat's app icon files from icon.json, an original design made of simple shapes
(rounded boxes, rounded polygons and round-capped lines on a 1024-unit square). Each pixel's
coverage comes from its signed distance to a shape, so edges are anti-aliased exactly.

    python3 scripts/app-icon/render.py        (needs numpy and Pillow; writes apps/mobile/assets)

Writes the iOS icon (1024 px, opaque, sRGB), the Android adaptive icon's layers (foreground and
monochrome inside the launcher's safe zone, background full-bleed), Android's notification icon
(the M alone, all white on transparency, 96 px), the web favicon, and icon.svg (the same shapes,
for reference)."""
import io
import json
import os
import numpy as np
from PIL import Image, ImageCms

N = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', '..', 'apps', 'mobile', 'assets')
# Android launchers may mask the foreground to a circle 66/108 of its size: shrink the artwork into it.
ANDROID_SCALE = 0.8
# Android's notification icon is drawn at 24 dp: the M alone, enlarged to fill most of its square.
NOTIFICATION_SCALE = 1.6


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def sd_rbox(px, py, x, y, w, h, r):
    qx = np.abs(px - (x + w / 2)) - (w / 2 - r)
    qy = np.abs(py - (y + h / 2)) - (h / 2 - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def sd_polygon(px, py, verts):
    vx = [v[0] for v in verts]
    vy = [v[1] for v in verts]
    d = (px - vx[0]) ** 2 + (py - vy[0]) ** 2
    s = np.ones_like(px)
    j = len(verts) - 1
    for i in range(len(verts)):
        ex, ey = vx[j] - vx[i], vy[j] - vy[i]
        wx, wy = px - vx[i], py - vy[i]
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
        d = np.minimum(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
        c1, c2, c3 = py >= vy[i], py < vy[j], (ex * wy) > (ey * wx)
        s = np.where((c1 & c2 & c3) | (~c1 & ~c2 & ~c3), -s, s)
        j = i
    return s * np.sqrt(d)


def sd_polyline(px, py, pts):
    d = np.full(px.shape, np.inf)
    for a, b in zip(pts, pts[1:]):
        pax, pay = px - a[0], py - a[1]
        bax, bay = b[0] - a[0], b[1] - a[1]
        h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
        d = np.minimum(d, np.hypot(pax - bax * h, pay - bay * h))
    return d


def sd_shape(px, py, shape):
    if shape[0] == 'rbox':
        return sd_rbox(px, py, *shape[1:])
    if shape[0] == 'poly':
        return sd_polygon(px, py, shape[1]) - shape[2]
    if shape[0] == 'line':
        return sd_polyline(px, py, shape[1]) - shape[2] / 2
    raise ValueError(shape[0])


def grid(size, scale):
    """Pixel centres in design units, with the artwork scaled by `scale` about the centre."""
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float64)
    unit = N / size
    px = ((xs + 0.5) * unit - N / 2) / scale + N / 2
    py = ((ys + 0.5) * unit - N / 2) / scale + N / 2
    return px, py, size / N * scale


def background(design, px, py):
    t = np.clip((px + py) / (2 * N), 0, 1)[..., None]
    return rgb(design['bg'][0]) * (1 - t) + rgb(design['bg'][1]) * t


def coverage(layer, px, py, pixels_per_unit):
    sd = np.min([sd_shape(px, py, shape) for shape in layer['shapes']], axis=0)
    return np.clip(0.5 - sd * pixels_per_unit, 0, 1)[..., None]


def render_opaque(design, size=N):
    px, py, k = grid(size, 1.0)
    out = background(design, px, py)
    for layer in design['layers']:
        cov = coverage(layer, px, py, k)
        out = out * (1 - cov) + rgb(layer['paint']) * cov
    return Image.fromarray(np.round(out).astype(np.uint8), 'RGB')


def render_layers(design, size=N, scale=1.0, colour=None):
    """The shapes alone on transparency (premultiplied while compositing); `colour` paints them all one colour."""
    px, py, k = grid(size, scale)
    premultiplied = np.zeros(px.shape + (3,))
    alpha = np.zeros(px.shape + (1,))
    for layer in design['layers']:
        cov = coverage(layer, px, py, k)
        paint = rgb(colour or layer['paint'])
        premultiplied = paint * cov + premultiplied * (1 - cov)
        alpha = cov + alpha * (1 - cov)
    colour_out = np.where(alpha > 0, premultiplied / np.maximum(alpha, 1e-9), 0)
    rgba = np.concatenate([colour_out, alpha * 255], axis=-1)
    return Image.fromarray(np.round(rgba).astype(np.uint8), 'RGBA')


def render_background(design, size=N):
    px, py, _ = grid(size, 1.0)
    return Image.fromarray(np.round(background(design, px, py)).astype(np.uint8), 'RGB')


def svg(design):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}">',
             f'<defs><linearGradient id="bg" x1="0" y1="0" x2="{N}" y2="{N}" gradientUnits="userSpaceOnUse">'
             f'<stop offset="0" stop-color="{design["bg"][0]}"/><stop offset="1" stop-color="{design["bg"][1]}"/></linearGradient></defs>',
             f'<rect width="{N}" height="{N}" fill="url(#bg)"/>']
    for layer in design['layers']:
        paint = layer['paint']
        for shape in layer['shapes']:
            if shape[0] == 'rbox':
                _, x, y, w, h, r = shape
                parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{paint}"/>')
            elif shape[0] == 'poly':
                points = ' '.join(f'{a},{b}' for a, b in shape[1])
                parts.append(f'<polygon points="{points}" fill="{paint}" stroke="{paint}" stroke-width="{2 * shape[2]}" stroke-linejoin="round"/>')
            elif shape[0] == 'line':
                points = ' '.join(f'{a},{b}' for a, b in shape[1])
                parts.append(f'<polyline points="{points}" fill="none" stroke="{paint}" stroke-width="{shape[2]}" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append('</svg>')
    return '\n'.join(parts) + '\n'


def srgb_profile():
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
    return profile.tobytes()


def main():
    design = json.load(open(os.path.join(HERE, 'icon.json')))
    icon = render_opaque(design)
    icon.save(os.path.join(ASSETS, 'icon.png'), optimize=True, icc_profile=srgb_profile())
    render_layers(design, scale=ANDROID_SCALE).save(os.path.join(ASSETS, 'android-icon-foreground.png'), optimize=True)
    render_layers(design, scale=ANDROID_SCALE, colour='#FFFFFF').save(os.path.join(ASSETS, 'android-icon-monochrome.png'), optimize=True)
    render_background(design).save(os.path.join(ASSETS, 'android-icon-background.png'), optimize=True)
    m_only = {**design, 'layers': design['layers'][:1]}
    render_layers(m_only, size=96, scale=NOTIFICATION_SCALE, colour='#FFFFFF').save(os.path.join(ASSETS, 'notification-icon.png'), optimize=True)
    render_opaque(design, 48).save(os.path.join(ASSETS, 'favicon.png'), optimize=True)
    with open(os.path.join(HERE, 'icon.svg'), 'w') as out:
        out.write(svg(design))
    print('wrote icon.png, android-icon-{foreground,monochrome,background}.png, notification-icon.png, favicon.png and icon.svg')


if __name__ == '__main__':
    main()
