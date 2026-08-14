#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Генератор GIF-баннеров Estate Art: «Бесплатная консультация при переезде».

Собирает по два файла на страну:
  • relocation-<страна>.gif       — 1200×630, для сайта (десктоп), Telegram, OG;
  • relocation-<страна>-p.gif     — 1000×1250, для телефона и вертикальных лент;
плюс статичные постеры .webp/.jpg для prefers-reduced-motion.

Стиль — quiet luxury сайта: тёмный teal, золотые волосяные линии,
антиква Baskerville в заголовке, Avenir Next в наборном тексте.

Анимация ограничена одной горизонтальной полосой (кнопка и линия рядом),
поэтому дельта-кадры GIF получаются маленькими и файлы остаются лёгкими.
Запуск:  python3 tools/make_banners.py
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "banners")

SS = 2                    # суперсэмплинг
FRAMES = 24
DURATION = 90             # мс на кадр → ~2.2 с цикл

# ---------- палитра сайта ----------
TEAL_DEEP = (8, 40, 37)
TEAL = (15, 63, 58)
CREAM = (255, 253, 248)
GOLD = (176, 140, 61)
GOLD_LIGHT = (227, 195, 120)

SERIF = "/System/Library/Fonts/Supplemental/Baskerville.ttc"
SANS = "/System/Library/Fonts/Avenir Next.ttc"
SERIF_REG, SERIF_BOLD, SERIF_ITAL, SERIF_SEMI = 0, 1, 2, 4
SANS_DEMI, SANS_MED, SANS_REG = 2, 5, 7

PHONE = "+7 912 486-95-08"
CTA_LABEL = "ПОЛУЧИТЬ КОНСУЛЬТАЦИЮ"
EYEBROW = "БЕСПЛАТНАЯ КОНСУЛЬТАЦИЯ"


def serif(size, face=SERIF_REG):
    return ImageFont.truetype(SERIF, int(size * SS), index=face)


def sans(size, face=SANS_REG):
    return ImageFont.truetype(SANS, int(size * SS), index=face)


def rgba(color, alpha):
    return (color[0], color[1], color[2], int(max(0, min(1, alpha)) * 255))


# ---------- текст с трекингом ----------
def text_width(font, text, tracking=0.0):
    if not tracking:
        return font.getlength(text)
    return sum(font.getlength(ch) + tracking for ch in text) - tracking if text else 0.0


def draw_tracked(draw, xy, text, font, fill, tracking=0.0):
    x, y = xy
    if not tracking:
        draw.text((x, y), text, font=font, fill=fill)
        return font.getlength(text)
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking
    return x - xy[0] - tracking


def draw_centered(draw, cx, y, text, font, fill, tracking=0.0):
    w = text_width(font, text, tracking)
    return draw_tracked(draw, (cx - w / 2, y), text, font, fill, tracking)


# ---------- фон ----------
def background(w_px, h_px):
    w, h = w_px * SS, h_px * SS
    base = Image.new("RGB", (w, h), TEAL_DEEP)
    d = ImageDraw.Draw(base)
    for y in range(h):
        k = y / (h - 1)
        c = tuple(int(TEAL[i] * (1 - k * 0.92) + TEAL_DEEP[i] * (k * 0.92)) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)

    # мягкое золотое сияние
    glow = Image.radial_gradient("L").resize((int(w * 1.15), int(h * 2.1)), Image.LANCZOS)
    glow = Image.eval(glow, lambda v: max(0, 255 - v))
    layer = Image.new("RGB", (w, h), (150, 118, 52))
    mask = Image.new("L", (w, h), 0)
    mask.paste(glow, (int(w * 0.42), int(-h * 0.55)))
    mask = mask.point(lambda v: int(v * 0.20))
    base = Image.composite(layer, base, mask)

    # лёгкий вес снизу
    dark = Image.new("RGB", (w, h), (4, 22, 20))
    dm = Image.new("L", (w, h))
    dd = ImageDraw.Draw(dm)
    for y in range(h):
        k = max(0.0, (y / h - 0.55) / 0.45)
        dd.line([(0, y), (w, y)], fill=int(70 * k * k))
    base = Image.composite(dark, base, dm)
    return base.convert("RGBA")


# ---------- линейные мотивы (гравюрный силуэт) ----------
def karst_polygon(ox, base_y, hgt, wid, harmonics):
    """Плавный силуэт карстовой скалы: колокол плюс пара гармоник."""
    pts = []
    steps = 90
    for i in range(steps + 1):
        t = i / steps
        x = ox + (t - 0.5) * 2 * wid
        env = math.cos(math.pi * (t - 0.5)) ** 1.5
        bump = sum(a * math.sin(math.pi * f * t + p) for a, f, p in harmonics)
        pts.append((x, base_y - hgt * max(0.0, env + bump * env)))
    pts.append((ox + wid, base_y))
    pts.append((ox - wid, base_y))
    return pts


def motif_vietnam(layer, cx, cy, s):
    """Халонг: карстовые острова и джонка."""
    d = ImageDraw.Draw(layer, "RGBA")
    lw = max(1, int(1.4 * SS))
    horizon = cy + int(0.40 * s)

    d.ellipse([cx - int(0.86 * s), cy - int(0.86 * s), cx + int(0.86 * s), cy + int(0.86 * s)],
              outline=rgba(GOLD_LIGHT, 0.22), width=lw)
    d.line([(cx - s, horizon), (cx + s, horizon)], fill=rgba(GOLD_LIGHT, 0.20), width=lw)

    d.polygon(karst_polygon(cx - 0.56 * s, horizon, 0.40 * s, 0.26 * s,
                            [(0.10, 3, 0.9), (0.05, 6, 2.1)]), fill=rgba(GOLD_LIGHT, 0.13))
    d.polygon(karst_polygon(cx + 0.52 * s, horizon, 0.31 * s, 0.22 * s,
                            [(0.12, 4, 2.4), (0.05, 7, 0.4)]), fill=rgba(GOLD_LIGHT, 0.13))
    d.polygon(karst_polygon(cx - 0.02 * s, horizon, 0.62 * s, 0.30 * s,
                            [(0.09, 3, 1.8), (0.04, 5, 0.2)]), fill=rgba(GOLD_LIGHT, 0.22))

    bx, by = cx + int(0.12 * s), horizon + int(0.26 * s)
    u = 0.30 * s
    hull = []
    for i in range(41):
        t = i / 40
        hull.append((bx + (t - 0.5) * 2 * u, by + 0.16 * u * math.sin(math.pi * t) + 0.10 * u))
    hull += [(bx + u * 1.06, by - 0.14 * u), (bx - u * 0.98, by - 0.12 * u)]
    d.polygon(hull, fill=rgba(GOLD_LIGHT, 0.55))
    d.line([(bx - 0.05 * u, by + 0.02 * u), (bx - 0.05 * u, by - 1.52 * u)],
           fill=rgba(GOLD_LIGHT, 0.50), width=lw)
    d.polygon([(bx - 0.02 * u, by - 1.50 * u), (bx + 0.62 * u, by - 1.24 * u),
               (bx + 1.00 * u, by - 0.86 * u), (bx + 0.80 * u, by - 0.16 * u),
               (bx - 0.02 * u, by - 0.16 * u)], fill=rgba(GOLD_LIGHT, 0.32))
    d.polygon([(bx - 0.12 * u, by - 1.10 * u), (bx - 0.62 * u, by - 0.80 * u),
               (bx - 0.86 * u, by - 0.42 * u), (bx - 0.12 * u, by - 0.16 * u)],
              fill=rgba(GOLD_LIGHT, 0.20))


def motif_thailand(layer, cx, cy, s):
    """Пханг-Нга: утёсы, солнце и лонгтейл."""
    d = ImageDraw.Draw(layer, "RGBA")
    lw = max(1, int(1.4 * SS))
    horizon = cy + int(0.40 * s)

    d.ellipse([cx - int(0.86 * s), cy - int(0.86 * s), cx + int(0.86 * s), cy + int(0.86 * s)],
              outline=rgba(GOLD_LIGHT, 0.22), width=lw)
    r = int(0.19 * s)
    sunx, suny = cx - int(0.40 * s), cy - int(0.38 * s)
    d.ellipse([sunx - r, suny - r, sunx + r, suny + r], outline=rgba(GOLD_LIGHT, 0.32), width=lw)
    d.line([(cx - s, horizon), (cx + s, horizon)], fill=rgba(GOLD_LIGHT, 0.20), width=lw)

    d.polygon(karst_polygon(cx - 0.60 * s, horizon, 0.36 * s, 0.24 * s,
                            [(0.13, 3, 0.4), (0.05, 6, 1.7)]), fill=rgba(GOLD_LIGHT, 0.13))
    d.polygon(karst_polygon(cx + 0.58 * s, horizon, 0.46 * s, 0.26 * s,
                            [(0.16, 3, 2.2), (0.07, 5, 0.6), (0.04, 8, 1.4)]),
              fill=rgba(GOLD_LIGHT, 0.18))

    bx, by = cx - int(0.02 * s), horizon + int(0.26 * s)
    u = 0.32 * s
    hull = []
    for i in range(41):
        t = i / 40
        hull.append((bx + (t - 0.5) * 2 * u, by + 0.06 * u + 0.17 * u * math.sin(math.pi * t)))
    hull += [(bx + 1.04 * u, by - 0.16 * u), (bx - 1.00 * u, by - 0.12 * u)]
    d.polygon(hull, fill=rgba(GOLD_LIGHT, 0.52))

    prow = (bx - 1.46 * u, by - 0.86 * u)
    d.line([(bx - 0.96 * u, by - 0.10 * u), prow], fill=rgba(GOLD_LIGHT, 0.52), width=int(2.2 * lw))
    for i in range(3):
        d.line([(prow[0] + 0.03 * u, prow[1] + 0.05 * u * i),
                (prow[0] + 0.28 * u + 0.08 * u * i, prow[1] + 0.20 * u + 0.08 * u * i)],
               fill=rgba(GOLD_LIGHT, 0.24), width=lw)
    d.line([(bx + 0.80 * u, by - 0.08 * u), (bx + 1.66 * u, by + 0.36 * u)],
           fill=rgba(GOLD_LIGHT, 0.40), width=lw)
    d.line([(bx + 1.52 * u, by + 0.40 * u), (bx + 1.76 * u, by + 0.22 * u)],
           fill=rgba(GOLD_LIGHT, 0.40), width=lw)


# ---------- стрелка (в Avenir нет глифа →) ----------
def draw_arrow(d, x, y, size, color, width):
    d.line([(x, y), (x + size, y)], fill=color, width=width)
    d.line([(x + size - size * 0.34, y - size * 0.30), (x + size, y)], fill=color, width=width)
    d.line([(x + size - size * 0.34, y + size * 0.30), (x + size, y)], fill=color, width=width)


# ---------- кнопка (единственная анимируемая часть) ----------
def cta_geometry(v):
    fb = sans(v["cta_font"], SANS_DEMI)
    tr = 2.0 * SS
    tw = text_width(fb, CTA_LABEL, tr)
    pad, gap, arr = 30 * SS, 16 * SS, 17 * SS
    bw = pad * 2 + tw + gap + arr
    x0 = ((v["w"] * SS - bw) / 2) if v["center"] else v["pad"] * SS
    return fb, tr, tw, pad, gap, arr, bw, x0


def draw_cta(img, v, phase):
    fb, tr, tw, pad, gap, arr, bw, x0 = cta_geometry(v)
    y0 = v["cta_y"] * SS
    x1, y1 = x0 + bw, y0 + v["cta_h"] * SS
    d = ImageDraw.Draw(img, "RGBA")

    # мягкое «дыхание» подсветки под кнопкой
    pulse = 0.5 - 0.5 * math.cos(phase * 2 * math.pi)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle(
        [x0 - 4 * SS, y0 - 2 * SS, x1 + 4 * SS, y1 + 4 * SS],
        radius=13 * SS, fill=rgba(GOLD, 0.09 + 0.13 * pulse))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(7 * SS)))

    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([x0, y0, x1, y1], radius=10 * SS, fill=GOLD)
    asc = fb.getbbox("НО")
    ty = y0 + (v["cta_h"] * SS - (asc[3] - asc[1])) / 2 - asc[1]
    draw_tracked(d, (x0 + pad, ty), CTA_LABEL, fb, CREAM, tr)

    nudge = ((math.sin(phase * 2 * math.pi) + 1) / 2) ** 2 * 6 * SS
    draw_arrow(d, x0 + pad + tw + gap + nudge, y0 + v["cta_h"] * SS / 2,
               arr, CREAM, max(1, int(1.7 * SS)))

    # волосяная линия с бегущей точкой (только в горизонтальном макете)
    if not v["center"]:
        lx0, lx1 = x1 + 34 * SS, (v["w"] - v["pad"]) * SS
        ly = y0 + v["cta_h"] * SS / 2
        d.line([(lx0, ly), (lx1, ly)], fill=rgba(GOLD_LIGHT, 0.22), width=max(1, SS))
        dx = lx0 + (lx1 - lx0) * phase
        fade = min(1.0, min(phase, 1 - phase) * 6)
        dot = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(dot).ellipse([dx - 8 * SS, ly - 8 * SS, dx + 8 * SS, ly + 8 * SS],
                                    fill=rgba(GOLD_LIGHT, 0.28 * fade))
        img.alpha_composite(dot.filter(ImageFilter.GaussianBlur(4 * SS)))
        ImageDraw.Draw(img, "RGBA").ellipse(
            [dx - 2.4 * SS, ly - 2.4 * SS, dx + 2.4 * SS, ly + 2.4 * SS],
            fill=rgba(GOLD_LIGHT, 0.95 * fade))


# ---------- базовый кадр ----------
def build_base(cfg, v):
    img = background(v["w"], v["h"])
    s, pad = SS, v["pad"]

    motif = Image.new("RGBA", img.size, (0, 0, 0, 0))
    cfg["motif"](motif, int(v["motif_x"] * s), int(v["motif_y"] * s), int(v["motif_s"] * s))
    img.alpha_composite(motif)

    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([v["frame"] * s, v["frame"] * s,
                         (v["w"] - v["frame"]) * s, (v["h"] - v["frame"]) * s],
                        radius=10 * s, outline=rgba(GOLD, 0.30), width=max(1, s))

    fw = serif(v["wordmark"], SERIF_SEMI)
    fp = sans(v["phone_font"], SANS_MED)
    fe = sans(v["eyebrow_font"], SANS_DEMI)
    fh = serif(cfg[v["h_key"]], SERIF_REG)
    fhi = serif(cfg[v["h_key"]], SERIF_ITAL)
    fs_ = sans(v["sub_font"], SANS_REG)
    ff = sans(v["foot_font"], SANS_MED)
    lh = cfg[v["h_key"]] * 1.02

    if v["center"]:
        cx = v["w"] * s / 2
        wm = text_width(fw, "ESTATE", 4.6 * s) + 11 * s + text_width(fw, "ART", 4.6 * s)
        x = cx - wm / 2
        x += draw_tracked(d, (x, v["wm_y"] * s), "ESTATE", fw, CREAM, 4.6 * s) + 11 * s
        draw_tracked(d, (x, v["wm_y"] * s), "ART", fw, GOLD_LIGHT, 4.6 * s)
        draw_centered(d, cx, v["phone_y"] * s, PHONE, fp, rgba(CREAM, 0.62), 1.1 * s)

        ew = text_width(fe, EYEBROW, 4.0 * s)
        d.line([(cx - ew / 2 - 42 * s, v["eyebrow_y"] * s + 8 * s),
                (cx - ew / 2 - 12 * s, v["eyebrow_y"] * s + 8 * s)], fill=GOLD, width=max(1, int(1.5 * s)))
        d.line([(cx + ew / 2 + 12 * s, v["eyebrow_y"] * s + 8 * s),
                (cx + ew / 2 + 42 * s, v["eyebrow_y"] * s + 8 * s)], fill=GOLD, width=max(1, int(1.5 * s)))
        draw_centered(d, cx, v["eyebrow_y"] * s, EYEBROW, fe, GOLD_LIGHT, 4.0 * s)

        draw_centered(d, cx, v["h_y"] * s, cfg["line1"], fh, CREAM)
        draw_centered(d, cx, v["h_y"] * s + lh * s, cfg["line2"], fhi, GOLD_LIGHT)
        for i, ln in enumerate(cfg["sub"]):
            draw_centered(d, cx, v["sub_y"] * s + i * v["sub_lh"] * s, ln, fs_, rgba(CREAM, 0.72))
        draw_centered(d, cx, v["foot_y"] * s, cfg["footer"], ff, rgba(CREAM, 0.40), 2.2 * s)
    else:
        x, y = pad * s, v["wm_y"] * s
        x += draw_tracked(d, (x, y), "ESTATE", fw, CREAM, 4.6 * s) + 11 * s
        draw_tracked(d, (x, y), "ART", fw, GOLD_LIGHT, 4.6 * s)
        pw = text_width(fp, PHONE, 1.1 * s)
        draw_tracked(d, ((v["w"] - pad) * s - pw, v["phone_y"] * s), PHONE, fp, rgba(CREAM, 0.62), 1.1 * s)

        ey = v["eyebrow_y"] * s
        d.line([(pad * s, ey + 8 * s), ((pad + 30) * s, ey + 8 * s)], fill=GOLD, width=max(1, int(1.5 * s)))
        draw_tracked(d, ((pad + 42) * s, ey), EYEBROW, fe, GOLD_LIGHT, 4.0 * s)

        d.text((pad * s, v["h_y"] * s), cfg["line1"], font=fh, fill=CREAM)
        d.text((pad * s, v["h_y"] * s + lh * s), cfg["line2"], font=fhi, fill=GOLD_LIGHT)
        for i, ln in enumerate(cfg["sub"]):
            d.text((pad * s, v["sub_y"] * s + i * v["sub_lh"] * s), ln, font=fs_, fill=rgba(CREAM, 0.72))
        draw_tracked(d, (pad * s, v["foot_y"] * s), cfg["footer"], ff, rgba(CREAM, 0.40), 2.2 * s)

    return img


def static_grain(v):
    """Статичное зерно против бандинга градиента.

    Одинаково во всех кадрах, поэтому дельта-кадры от него не растут.
    В анимируемой полосе зерно гасится — там перерисовка идёт каждый кадр
    и шум стоил бы втрое дороже.
    """
    sigma = v.get("grain", 2.4)
    if not sigma:
        return Image.new("RGB", (v["w"], v["h"]), (128, 128, 128))
    grain = Image.effect_noise((v["w"], v["h"]), sigma)
    mask = Image.new("L", (v["w"], v["h"]), 255)
    ImageDraw.Draw(mask).rectangle([0, v["cta_y"] - 36, v["w"], v["cta_y"] + v["cta_h"] + 42], fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(11))
    flat = Image.new("L", (v["w"], v["h"]), 128)
    return Image.composite(grain, flat, mask).convert("RGB")


def render(cfg, v):
    name = cfg["name"] + v["suffix"]
    base = build_base(cfg, v)
    grain = static_grain(v)
    frames = []
    for i in range(FRAMES):
        f = base.copy()
        draw_cta(f, v, i / FRAMES)
        f = f.convert("RGB").resize((v["w"], v["h"]), Image.LANCZOS)
        frames.append(ImageChops.add(f, grain, 1.0, -128))

    os.makedirs(OUT, exist_ok=True)

    montage = Image.new("RGB", (v["w"], v["h"] * 3))
    for k, idx in enumerate((0, FRAMES // 3, 2 * FRAMES // 3)):
        montage.paste(frames[idx], (0, v["h"] * k))
    pal = montage.quantize(colors=255, method=Image.MEDIANCUT)
    qframes = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]

    gif = os.path.join(OUT, name + ".gif")
    qframes[0].save(gif, save_all=True, append_images=qframes[1:], loop=0,
                    duration=DURATION, optimize=True, disposal=1)
    webp = os.path.join(OUT, name + ".webp")
    frames[0].save(webp, format="WEBP", quality=90, method=6)
    jpg = os.path.join(OUT, name + ".jpg")
    frames[0].save(jpg, format="JPEG", quality=88, optimize=True, progressive=True)
    print(f"  ✓ {name}: gif {os.path.getsize(gif)/1024:.0f} КБ · "
          f"webp {os.path.getsize(webp)/1024:.0f} КБ · jpg {os.path.getsize(jpg)/1024:.0f} КБ")


# ---------- макеты ----------
WIDE = dict(
    suffix="", w=1200, h=630, pad=72, frame=28, center=False,
    wordmark=23, wm_y=52, phone_font=16, phone_y=57,
    eyebrow_font=13, eyebrow_y=172,
    h_key="h_size", h_y=210,
    sub_font=19, sub_y=400, sub_lh=31,
    cta_font=14, cta_y=476, cta_h=58,
    foot_font=12, foot_y=568,
    motif_x=948, motif_y=288, motif_s=196,
)

PORTRAIT = dict(
    suffix="-p", w=1000, h=1250, pad=72, frame=26, center=True,
    wordmark=26, wm_y=74, phone_font=16, phone_y=1188,
    eyebrow_font=13, eyebrow_y=716,
    h_key="h_size_p", h_y=760,
    sub_font=20, sub_y=940, sub_lh=33,
    cta_font=15, cta_y=1042, cta_h=62,
    foot_font=12, foot_y=1146,
    motif_x=500, motif_y=400, motif_s=250,
    # на телефоне баннер показывается в ~28% натуральной ширины —
    # бандинг там незаметен, а зерно утроило бы вес GIF
    grain=0,
)

CONFIGS = [
    dict(
        name="relocation-vietnam",
        motif=motif_vietnam,
        h_size=62, h_size_p=64,
        line1="Переезд во Вьетнам",
        line2="спокойно и по плану",
        sub=["Виза, жильё, банк, школа и налоги —",
             "разберём ваш случай за один звонок."],
        footer="ДАНАНГ · НЯЧАНГ · ФУКУОК · ХОШИМИН",
    ),
    dict(
        name="relocation-thailand",
        motif=motif_thailand,
        h_size=62, h_size_p=64,
        line1="Переезд в Таиланд",
        line2="спокойно и по плану",
        sub=["Виза, жильё, банк, школа и налоги —",
             "разберём ваш случай за один звонок."],
        footer="ПХУКЕТ · БАНГКОК · САМУИ · ЧИАНГМАЙ",
    ),
]

if __name__ == "__main__":
    print("Собираю баннеры…")
    for cfg in CONFIGS:
        for variant in (WIDE, PORTRAIT):
            render(cfg, variant)
