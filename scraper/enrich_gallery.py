#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
enrich_gallery.py — добавляет галерею фото к существующим объектам catalog.json
==============================================================================

Для каждого объекта заходит на его source_url (detail-страницу fazwaz),
собирает несколько фотографий именно этого объекта, скачивает их в
assets/catalog/u<id>_g*.jpg и дописывает в объект поле "images" (список путей).
НЕ пере-парсит каталог — объекты и их slug/url остаются прежними.

Запуск:  python3 scraper/enrich_gallery.py [--max 6] [--delay 1.0]
"""
import argparse
import json
import os
import re
import sys
import time
from urllib.parse import urlparse
import requests

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE = "https://www.fazwaz.ru"
IMG_RE_TMPL = r'https://cdn\.fazwaz\.com/[a-z]+/[A-Za-z0-9_-]+/(\d+)x(\d+)/unit/{uid}/([^"\'\\ ?]+)'


def img_ext(url):
    ext = os.path.splitext(urlparse(url).path)[1].lower().lstrip(".")
    return ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"


def best_images(html, uid, limit):
    """Лучший (по разумному размеру) URL на каждый файл фото объекта."""
    by_file = {}
    for m in re.finditer(IMG_RE_TMPL.format(uid=re.escape(str(uid))), html):
        w, h, fname = int(m.group(1)), int(m.group(2)), m.group(3)
        # «вес» размера: предпочитаем ширину 500..1100, иначе по площади
        score = (1 if 500 <= w <= 1100 else 0, w * h)
        cur = by_file.get(fname)
        if not cur or score > cur[0]:
            by_file[fname] = (score, m.group(0), w)
    # сортируем: сначала «главное» фото, потом по ширине
    items = sorted(by_file.items(), key=lambda kv: (-(kv[1][2])))
    urls = [v[1] for _, v in items]
    return urls[:limit]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=6, help="макс. фото в галерее на объект")
    ap.add_argument("--delay", type=float, default=1.0)
    args = ap.parse_args()

    cat_path = os.path.join(root, "data", "catalog.json")
    img_dir = os.path.join(root, "assets", "catalog")
    os.makedirs(img_dir, exist_ok=True)
    data = json.load(open(cat_path, encoding="utf-8"))
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})

    total = 0
    for it in data.get("items", []):
        uid, url = it.get("id"), it.get("source_url")
        if not uid or not url:
            continue
        try:
            html = s.get(url, headers={"Referer": BASE + "/"}, timeout=30).text
        except requests.RequestException as e:
            print(f"  ! {uid}: страница не загрузилась ({e})", file=sys.stderr)
            continue
        urls = best_images(html, uid, args.max)
        time.sleep(args.delay)
        gallery = []
        for i, iu in enumerate(urls, 1):
            fname = f"u{uid}_g{i}.{img_ext(iu)}"
            try:
                r = s.get(iu, headers={"Referer": BASE + "/"}, timeout=30)
                r.raise_for_status()
                with open(os.path.join(img_dir, fname), "wb") as f:
                    f.write(r.content)
                gallery.append(f"assets/catalog/{fname}")
                time.sleep(args.delay * 0.4)
            except requests.RequestException:
                pass
        if gallery:
            it["images"] = gallery
            it["image"] = gallery[0]  # главное фото — первое из галереи
            total += len(gallery)
            print(f"  ✓ {it.get('title','')[:30]}: {len(gallery)} фото")
        else:
            print(f"  · {it.get('title','')[:30]}: галерея не найдена, оставляю как было")

    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Скачано фото: {total}. catalog.json обновлён (поле images).")


if __name__ == "__main__":
    main()
