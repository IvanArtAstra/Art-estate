#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scrape_fazwaz.py — обновление каталога Estate Art данными с fazwaz.ru
====================================================================

Берёт ПУБЛИЧНЫЕ страницы листингов (server-rendered HTML), вытаскивает
структурированные данные из встроенных в карточки JSON-блоков, при
необходимости заходит на страницу объекта за крупным фото, скачивает
изображения и формирует data/catalog.json для сайта.

ПРАВОВОЕ ПРЕДУПРЕЖДЕНИЕ
-----------------------
fazwaz.ru — сторонний сайт. Фотографии и описания объектов принадлежат их
авторам/агентствам, а Условия использования таких площадок обычно ЗАПРЕЩАЮТ
автоматический сбор и перепубликацию контента. Используйте этот инструмент
ответственно: для анализа рынка или для объектов, на которые у вас есть права.
robots.txt fazwaz запрещает /api/ и /graphql — парсер их НЕ трогает и работает
только с публичными HTML-страницами, с паузами между запросами.

Зависимости: только `requests` (стандартный stdlib + requests). bs4 не нужен —
данные берём из чистых JSON-блоков в разметке.

Запуск:
    python3 scraper/scrape_fazwaz.py --pages 1 --limit 9
    python3 scraper/scrape_fazwaz.py --category "/вилла-продажа/таиланд/пхукет" --pages 2 --limit 12
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

import requests

BASE = "https://www.fazwaz.ru"
DEFAULT_CATEGORY = "/недвижимость-продажа/таиланд/пхукет"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Цена на fazwaz.ru отдаётся в KZT. Курсы для конвертации в USD — ПРАВЬТЕ при
# необходимости (значения приблизительные). Ключ — код валюты из данных.
RATES_TO_USD = {"KZT": 1 / 485.0, "THB": 1 / 36.5, "RUB": 1 / 92.0,
                "USD": 1.0, "EUR": 1.08}

CARD_RE = re.compile(r"bridgeSearchMouseOver',\s*\d+,\s*'(\{.*?\})'\)", re.S)
CUR_SYMBOLS = {"฿": "THB", "$": "USD", "€": "EUR", "₽": "RUB"}

# Предпочтительные размеры крупного фото на detail-странице (по убыванию вкуса)
DETAIL_IMG_SIZES = ("810x438", "950x505", "540x292", "750x750", "500x500")
DETAIL_IMG_RE_TMPL = (r'https://cdn\.fazwaz\.com/[a-z]+/[A-Za-z0-9_-]+/'
                      r'{size}/unit/\d+/[^"\'\\ ?]+')


def make_session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})
    return s


def fetch_text(s, url, referer=None):
    headers = {"Referer": referer} if referer else {}
    r = s.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.text


def fetch_bytes(s, url, referer=BASE + "/"):
    headers = {"Referer": referer} if referer else {}
    r = s.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.content


def parse_price(raw):
    """'KZT112,000,000' / '฿ 12,000,000' -> (amount:int|None, currency:str)"""
    if not raw:
        return None, None
    m = re.match(r"\s*([A-Za-z]{3}|[฿$€₽])?\s*([\d ,. ]+)", raw)
    if not m:
        return None, None
    cur = (m.group(1) or "").strip()
    cur = CUR_SYMBOLS.get(cur, cur or "KZT")
    digits = re.sub(r"[^\d]", "", m.group(2) or "")
    amount = int(digits) if digits else None
    return amount, cur


def to_usd(amount, cur):
    if amount is None:
        return None
    rate = RATES_TO_USD.get(cur)
    return round(amount * rate) if rate else None


def fmt_money(n, symbol="$"):
    """231000 -> '$231 000' (пробелы между разрядами, рус. стиль)."""
    if n is None:
        return None
    return symbol + format(int(n), ",d").replace(",", " ")


def parse_area(raw):
    m = re.search(r"([\d.]+)", raw or "")
    return float(m.group(1)) if m else None


def unit_id(detail_url):
    m = re.search(r"u(\d+)\b", detail_url or "")
    return m.group(1) if m else None


def img_ext(url):
    path = urlparse(url).path
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    return ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"


def extract_cards(html_text):
    """Вернуть список dict из встроенных JSON-блоков карточек."""
    out, seen = [], set()
    for raw in CARD_RE.findall(html_text):
        try:
            obj = json.loads(html.unescape(raw))
        except json.JSONDecodeError:
            continue
        uid = unit_id(obj.get("detailUrl", ""))
        if not uid or uid in seen:
            continue
        seen.add(uid)
        out.append(obj)
    return out


def extract_geo(html_text):
    """Карта {unit_id: (lat, lng)} из ld+json страницы листинга."""
    geo = {}
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html_text, re.S)
    if not m:
        return geo
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return geo
    for d in (data if isinstance(data, list) else [data]):
        g = d.get("geo") if isinstance(d, dict) else None
        uid = unit_id(d.get("url", "")) if isinstance(d, dict) else None
        if uid and g and g.get("latitude") and g.get("longitude"):
            geo[uid] = (g["latitude"], g["longitude"])
    return geo


DESC_META_RE = re.compile(r'<meta[^>]+name="description"[^>]+content="([^"]+)"')
RENT_RE = re.compile(r"АРЕНДА.*?([\d][\d , ]{2,})\s*฿", re.S)


def detail_info(s, detail_url):
    """Один заход на detail-страницу: крупное фото, краткое описание, аренда/мес (USD)."""
    info = {}
    try:
        h = fetch_text(s, detail_url, referer=BASE + "/")
    except requests.RequestException:
        return info
    for size in DETAIL_IMG_SIZES:
        m = re.search(DETAIL_IMG_RE_TMPL.format(size=re.escape(size)), h)
        if m:
            info["img"] = m.group(0)
            break
    md = DESC_META_RE.search(h)
    if md:
        full = re.sub(r"\s+", " ", html.unescape(md.group(1))).strip()
        info["desc"] = (full[:177].rstrip() + "…") if len(full) > 180 else full
        rm = RENT_RE.search(full)
        if rm:
            n = int(re.sub(r"[^\d]", "", rm.group(1)))
            if n:
                info["rent_usd"] = round(n * RATES_TO_USD["THB"])
    return info


def normalize(card, s, img_dir, rel_dir, geo_by_id=None, hires=True, delay=1.0):
    uid = unit_id(card.get("detailUrl", ""))
    amount, cur = parse_price(card.get("price"))
    usd = to_usd(amount, cur)

    # Старая цена и скидка (firstPrice — цена до снижения)
    first_amt, first_cur = parse_price(card.get("firstPrice"))
    first_usd = to_usd(first_amt, first_cur)
    discount = None
    if first_usd and usd and first_usd > usd:
        discount = round((first_usd - usd) / first_usd * 100)
    else:
        first_usd = None  # скидки нет — не показываем «старую» цену

    # Локация: "Район, Округ, Провинция" -> "Район, Провинция" (без среднего округа)
    parts = [p.strip() for p in (card.get("formatted_address", "") or "").split(",") if p.strip()]
    if len(parts) >= 2:
        loc = parts[0] + ", " + parts[-1] if parts[0] != parts[-1] else parts[0]
    else:
        loc = parts[0] if parts else ""

    beach = None
    for np_ in (card.get("nearPlaceGroup") or []):
        if np_.get("clean_name") == "beach":
            beach = f"{np_.get('tooltip', 'Пляж')} · {np_.get('distance', '')}".strip(" ·")
            break

    # Заход на detail-страницу: фото + описание + аренда (для калькулятора доходности)
    info = {}
    if hires:
        info = detail_info(s, card["detailUrl"])
        time.sleep(delay)
    img_url = info.get("img") or card.get("thumbnail")

    local_rel = None
    if img_url:
        ext = img_ext(img_url)
        fname = f"u{uid}.{ext}"
        try:
            data = fetch_bytes(s, img_url)
            with open(os.path.join(img_dir, fname), "wb") as f:
                f.write(data)
            local_rel = f"{rel_dir}/{fname}"
        except requests.RequestException as e:
            print(f"  ! фото {uid} не скачалось: {e}", file=sys.stderr)

    area = parse_area(card.get("area"))
    price_per_m2 = round(usd / area) if (usd and area) else None
    geo = (geo_by_id or {}).get(uid)

    return {
        "id": uid,
        "title": card.get("name"),
        "type": card.get("propertyType"),
        "beds": card.get("bedrooms"),
        "baths": card.get("bathrooms"),
        "area": area,
        "location": loc,
        "beach": beach,
        "priceUSD": usd,
        "priceLabel": fmt_money(usd) if usd else (card.get("price") or "Цена по запросу"),
        "priceOriginal": card.get("price"),
        "oldPriceUSD": first_usd,
        "oldPriceLabel": fmt_money(first_usd) if first_usd else None,
        "discountPct": discount,
        "pricePerM2": price_per_m2,
        "rentMonthUSD": info.get("rent_usd"),
        "description": info.get("desc"),
        "lat": geo[0] if geo else None,
        "lng": geo[1] if geo else None,
        "image": local_rel,
        "source_url": card.get("detailUrl"),
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)

    ap = argparse.ArgumentParser(description="Парсер каталога fazwaz.ru для Estate Art")
    ap.add_argument("--category", default=DEFAULT_CATEGORY,
                    help="путь категории на fazwaz.ru (по умолчанию: вся Пхукет-недвижимость)")
    ap.add_argument("--pages", type=int, default=1, help="сколько страниц листинга обойти")
    ap.add_argument("--limit", type=int, default=9, help="максимум объектов в каталоге")
    ap.add_argument("--delay", type=float, default=1.2, help="пауза между запросами, сек")
    ap.add_argument("--no-hires", action="store_true",
                    help="не заходить на detail-страницы (быстрее, но фото мельче)")
    ap.add_argument("--allow-dup-titles", action="store_true",
                    help="не схлопывать объекты с одинаковым названием ЖК (по умолчанию схлопываются)")
    ap.add_argument("--out-json", default=os.path.join(root, "data", "catalog.json"))
    ap.add_argument("--img-dir", default=os.path.join(root, "assets", "catalog"))
    ap.add_argument("--rel-dir", default="assets/catalog",
                    help="путь к фото относительно корня сайта (для catalog.json)")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.out_json), exist_ok=True)
    os.makedirs(args.img_dir, exist_ok=True)

    s = make_session()
    cards = []
    geo_by_id = {}
    base_url = BASE + args.category
    print(f"Категория: {base_url}")
    for page in range(1, args.pages + 1):
        url = base_url if page == 1 else f"{base_url}?page={page}"
        print(f"→ страница {page}: {url}")
        try:
            h = fetch_text(s, url, referer=BASE + "/")
        except requests.RequestException as e:
            print(f"  ! страница {page} не загрузилась: {e}", file=sys.stderr)
            continue
        page_cards = extract_cards(h)
        geo_by_id.update(extract_geo(h))
        print(f"  найдено карточек: {len(page_cards)}")
        cards.extend(page_cards)
        time.sleep(args.delay)
        if len(cards) >= args.limit:
            break

    # дедуп по id (+ по названию ЖК, если не отключено), обрезка до лимита
    uniq, seen_id, seen_title = [], set(), set()
    for c in cards:
        uid = unit_id(c.get("detailUrl", ""))
        title_key = (c.get("name") or "").strip().lower()
        if not uid or uid in seen_id:
            continue
        if not args.allow_dup_titles and title_key and title_key in seen_title:
            continue
        seen_id.add(uid)
        seen_title.add(title_key)
        uniq.append(c)
    uniq = uniq[: args.limit]
    print(f"\nОбъектов к обработке: {len(uniq)} (hires={'нет' if args.no_hires else 'да'})")

    items = []
    for i, c in enumerate(uniq, 1):
        print(f"[{i}/{len(uniq)}] {c.get('name')}")
        items.append(normalize(c, s, args.img_dir, args.rel_dir, geo_by_id=geo_by_id,
                               hires=not args.no_hires, delay=args.delay))

    catalog = {
        "updated": dt.date.today().isoformat(),
        "source": "fazwaz.ru",
        "note": "Данные собраны с fazwaz.ru. Проверьте права на использование контента.",
        "count": len(items),
        "items": items,
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Готово: {args.out_json} ({len(items)} объектов)")
    print(f"✓ Изображения: {args.img_dir}")


if __name__ == "__main__":
    main()
