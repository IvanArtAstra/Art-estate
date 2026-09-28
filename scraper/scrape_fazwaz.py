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

# Регионы, которые умеет собирать парсер. Ключ — значение для --regions.
# country/city попадают в каждый объект каталога: по ним работают фильтры
# и переключатель стран на сайте.
REGIONS = {
    "phuket": dict(
        category="/недвижимость-продажа/таиланд/пхукет",
        country="th", countryName="Таиланд", city="Пхукет",
    ),
    "danang": dict(
        category="/недвижимость-продажа/вьетнам/дананг",
        country="vn", countryName="Вьетнам", city="Дананг",
    ),
    "nhatrang": dict(
        category="/недвижимость-продажа/вьетнам/khanh-hoa/nha-trang",
        country="vn", countryName="Вьетнам", city="Нячанг",
    ),
}
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Цена на fazwaz.ru отдаётся в KZT. Курсы для конвертации в USD — ПРАВЬТЕ при
# необходимости (значения приблизительные). Ключ — код валюты из данных.
RATES_TO_USD = {"KZT": 1 / 485.0, "THB": 1 / 36.5, "RUB": 1 / 92.0,
                "VND": 1 / 26000.0, "USD": 1.0, "EUR": 1.08}

CARD_RE = re.compile(r"bridgeSearchMouseOver',\s*\d+,\s*'(\{.*?\})'\)", re.S)
CUR_SYMBOLS = {"฿": "THB", "$": "USD", "€": "EUR", "₽": "RUB", "₫": "VND", "₸": "KZT"}

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
    m = re.match(r"\s*([A-Za-z]{3}|[฿$€₽₫₸])?\s*([\d ,. ]+)", raw)
    if not m:
        return None, None
    cur = (m.group(1) or "").strip()
    if not cur:
        # вьетнамский формат ставит знак валюты после суммы: «39,400,000,000 ₫»
        t = re.search(r"([A-Za-z]{3}|[฿$€₽₫₸])\s*$", raw.strip())
        cur = t.group(1) if t else ""
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


MARKER_JSON_RE = re.compile(
    r'<script type="application/json" id="search-marker-payloads">(.*?)</script>', re.S)


def extract_cards(html_text):
    """Вернуть список dict-карточек со страницы листинга.

    С 2026 года fazwaz отдаёт все карточки одним JSON-блоком
    <script type="application/json" id="search-marker-payloads">, где ключ — id
    юнита. Старый формат (inline-вызовы bridgeSearchMouseOver) оставлен как
    запасной путь на случай отката вёрстки.
    """
    out, seen = [], set()

    m = MARKER_JSON_RE.search(html_text)
    if m:
        try:
            payload = json.loads(m.group(1))
        except json.JSONDecodeError:
            payload = {}
        for uid, obj in payload.items():
            if not isinstance(obj, dict):
                continue
            uid = str(uid) or unit_id(obj.get("detailUrl", ""))
            if not uid or uid in seen:
                continue
            seen.add(uid)
            out.append(obj)
        if out:
            return out

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
PROJECT_LINK_RE = re.compile(r'href="(https://www\.fazwaz\.[a-z]+/(?:проекты|projects)/[^"]+)"')
LAT_RE = re.compile(r'"latitude"\s*:\s*"?(-?\d+\.\d+)')
LNG_RE = re.compile(r'"longitude"\s*:\s*"?(-?\d+\.\d+)')
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
    mp = PROJECT_LINK_RE.search(h)
    if mp:
        info["project_url"] = mp.group(1)
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


# Координаты. С 2026 года fazwaz не отдаёт lat/lng ни в листинге, ни в карточке
# объекта — они остались только на странице ЖК, куда ведёт ссылка с detail-страницы.
# Если ЖК не найден, адрес геокодируется через Nominatim (OSM).
_GEO_CACHE = {}
CITY_EN = {"Дананг": "Da Nang", "Нячанг": "Nha Trang", "Пхукет": "Phuket",
           "Хошимин": "Ho Chi Minh City", "Ханой": "Hanoi"}
NOMINATIM_UA = "EstateArt-catalog/1.0 (+https://ivanartastra.github.io/Art-estate/)"


def project_geo(s, project_url):
    """(lat, lng) со страницы ЖК на fazwaz."""
    if not project_url:
        return None
    if project_url in _GEO_CACHE:
        return _GEO_CACHE[project_url]
    try:
        h = fetch_text(s, project_url, referer=BASE + "/")
    except requests.RequestException:
        _GEO_CACHE[project_url] = None
        return None
    la, ln = LAT_RE.search(h), LNG_RE.search(h)
    res = (float(la.group(1)), float(ln.group(1))) if (la and ln) else None
    _GEO_CACHE[project_url] = res
    return res


def geocode_osm(address, country_name=None):
    """Запасной геокодер: Nominatim. Точность — до квартала, этого хватает карте."""
    if not address:
        return None
    parts = [CITY_EN.get(p.strip(), p.strip()) for p in address.split(",") if p.strip()]
    if country_name:
        parts.append({"Вьетнам": "Vietnam", "Таиланд": "Thailand"}.get(country_name, country_name))
    q = ", ".join(dict.fromkeys(parts))
    if q in _GEO_CACHE:
        return _GEO_CACHE[q]
    try:
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"format": "json", "limit": 1, "q": q},
                         headers={"User-Agent": NOMINATIM_UA}, timeout=25)
        r.raise_for_status()
        data = r.json()
        res = (float(data[0]["lat"]), float(data[0]["lon"])) if data else None
    except (requests.RequestException, ValueError, KeyError, IndexError):
        res = None
    _GEO_CACHE[q] = res
    time.sleep(1.1)  # правила Nominatim: не чаще одного запроса в секунду
    return res


def normalize(card, s, img_dir, rel_dir, geo_by_id=None, hires=True, delay=1.0,
              region=None):
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
    if not geo:
        geo = project_geo(s, info.get("project_url"))
    if not geo:
        geo = geocode_osm(loc, (region or {}).get("countryName"))

    region = region or {}
    return {
        "id": uid,
        "country": region.get("country"),
        "countryName": region.get("countryName"),
        "city": region.get("city"),
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


# --- Фильтр качества -------------------------------------------------------
# В категориях «продажа» у fazwaz по Вьетнаму попадается мусор: объявления об
# аренде, реклама агентов капсом на вьетнамском и битые цены (когда в поле цены
# оказывается месячная аренда). На витрине премиального сайта это выглядит плохо,
# поэтому такие карточки отсеиваются ещё до захода на detail-страницу.

BAD_TITLE_RE = re.compile(
    r"(cho thuê|for rent|rental|/month|/мес|в месяц|thanh toán|liên hệ|giá rẻ|"
    r"chính chủ|cần bán|bán gấp|hot deal|khuyến mãi)", re.I)
EMOJI_RE = re.compile("[🌀-🫿☀-➿⬀-⯿️]")
MIN_SALE_USD = 25_000        # ниже — почти наверняка аренда или ошибка
MIN_PPM_USD = 400            # $/м², вменяемый низ для Вьетнама и Таиланда
MAX_PPM_USD = 25_000
MAX_TITLE_LEN = 58           # длиннее — это рекламный текст, а не название ЖК


def card_quality(card):
    """(ok, причина). Проверка по данным карточки, без лишних запросов."""
    title = (card.get("name") or "").strip()
    if not title:
        return False, "без названия"
    if EMOJI_RE.search(title):
        return False, "эмодзи в названии — рекламное объявление"
    if BAD_TITLE_RE.search(title):
        return False, "название про аренду или рекламу"
    if title.startswith("[") or title.isupper():
        return False, "название оформлено как объявление агента"
    if len(title) > MAX_TITLE_LEN:
        return False, f"название длиной {len(title)} — это рекламный текст"

    amount, cur = parse_price(card.get("price"))
    usd = to_usd(amount, cur)
    if not usd:
        return False, "цена не распознана"
    if usd < MIN_SALE_USD:
        return False, f"${usd} — это не цена продажи"
    area = parse_area(card.get("area"))
    if not area:
        return False, "нет площади"
    ppm = usd / area
    if ppm < MIN_PPM_USD or ppm > MAX_PPM_USD:
        return False, f"${ppm:,.0f} за м² — вне разумного диапазона"
    return True, ""


def scrape_region(s, key, region, args):
    """Собрать один регион и вернуть список нормализованных объектов."""
    base_url = BASE + region["category"]
    print(f"\n=== {region['city']} ({region['countryName']}) ===")
    print(f"Категория: {base_url}")

    cards, geo_by_id = [], {}
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
        if not page_cards:
            break

    # дедуп по id (+ по названию ЖК, если не отключено), фильтр качества, лимит
    uniq, seen_id, seen_title, rejected = [], set(), set(), []
    for c in cards:
        uid = unit_id(c.get("detailUrl", ""))
        title_key = (c.get("name") or "").strip().lower()
        if not uid or uid in seen_id:
            continue
        if not args.allow_dup_titles and title_key and title_key in seen_title:
            continue
        if not args.no_quality_filter:
            ok, why = card_quality(c)
            if not ok:
                rejected.append((c.get("name") or uid, why))
                continue
        seen_id.add(uid)
        seen_title.add(title_key)
        uniq.append(c)
    if rejected:
        print(f"  отсеяно по качеству: {len(rejected)}")
        for name, why in rejected[:8]:
            print(f"    − {str(name)[:44]:46} {why}")
        if len(rejected) > 8:
            print(f"    … и ещё {len(rejected) - 8}")
    uniq = uniq[: args.limit]
    print(f"Объектов к обработке: {len(uniq)} (hires={'нет' if args.no_hires else 'да'})")

    items = []
    for i, c in enumerate(uniq, 1):
        print(f"[{i}/{len(uniq)}] {c.get('name')}")
        it = normalize(c, s, args.img_dir, args.rel_dir, geo_by_id=geo_by_id,
                       hires=not args.no_hires, delay=args.delay, region=region)
        # Без фото карточка подставила бы фолбэк с другой страны — лучше пропустить
        if not it.get("image"):
            print(f"    − пропущен: фото не скачалось")
            continue
        items.append(it)
    return items


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)

    ap = argparse.ArgumentParser(description="Парсер каталога fazwaz.ru для Estate Art")
    ap.add_argument("--regions", default="phuket",
                    help="регионы через запятую: " + ", ".join(REGIONS) + " (по умолчанию: phuket)")
    ap.add_argument("--category", default=None,
                    help="произвольный путь категории на fazwaz.ru вместо --regions")
    ap.add_argument("--country", default="", help="код страны для --category, например vn")
    ap.add_argument("--country-name", default="", help="название страны для --category")
    ap.add_argument("--city", default="", help="город для --category")
    ap.add_argument("--merge", action="store_true",
                    help="дописать в существующий catalog.json, сохранив объекты других городов")
    ap.add_argument("--append", action="store_true",
                    help="долить новые объекты, не трогая уже собранные (в т.ч. их галереи)")
    ap.add_argument("--pages", type=int, default=1, help="сколько страниц листинга обойти на регион")
    ap.add_argument("--limit", type=int, default=9, help="максимум объектов на регион")
    ap.add_argument("--delay", type=float, default=1.2, help="пауза между запросами, сек")
    ap.add_argument("--no-hires", action="store_true",
                    help="не заходить на detail-страницы (быстрее, но фото мельче)")
    ap.add_argument("--no-quality-filter", action="store_true",
                    help="не отсеивать аренду, рекламные заголовки и битые цены")
    ap.add_argument("--allow-dup-titles", action="store_true",
                    help="не схлопывать объекты с одинаковым названием ЖК (по умолчанию схлопываются)")
    ap.add_argument("--out-json", default=os.path.join(root, "data", "catalog.json"))
    ap.add_argument("--img-dir", default=os.path.join(root, "assets", "catalog"))
    ap.add_argument("--rel-dir", default="assets/catalog",
                    help="путь к фото относительно корня сайта (для catalog.json)")
    args = ap.parse_args()

    if args.category:
        targets = {"custom": dict(category=args.category, country=args.country or None,
                                  countryName=args.country_name or None, city=args.city or None)}
    else:
        targets = {}
        for key in [k.strip() for k in args.regions.split(",") if k.strip()]:
            if key not in REGIONS:
                sys.exit(f"Неизвестный регион «{key}». Доступны: {', '.join(REGIONS)}")
            targets[key] = REGIONS[key]

    os.makedirs(os.path.dirname(args.out_json), exist_ok=True)
    os.makedirs(args.img_dir, exist_ok=True)

    s = make_session()
    items = []
    for key, region in targets.items():
        items.extend(scrape_region(s, key, region, args))

    if (args.merge or args.append) and os.path.exists(args.out_json):
        with open(args.out_json, encoding="utf-8") as f:
            old = json.load(f)
        prev = old.get("items", [])
        if args.append:
            # Доливаем только незнакомые id: у уже собранных объектов остаются
            # галереи из enrich_gallery.py, перезаписывать их нельзя
            known = {it.get("id") for it in prev}
            fresh = [it for it in items if it["id"] not in known]
            print(f"\nДолив: было {len(prev)}, новых {len(fresh)}, "
                  f"уже знакомых пропущено {len(items) - len(fresh)}")
            items = prev + fresh
        else:
            touched = {r.get("city") for r in targets.values() if r.get("city")}
            kept = [it for it in prev if it.get("city") not in touched]
            fresh_ids = {it["id"] for it in items}
            kept = [it for it in kept if it.get("id") not in fresh_ids]
            print(f"\nСлияние: сохранено {len(kept)} объектов других городов, добавлено {len(items)}")
            items = kept + items

    catalog = {
        "updated": dt.date.today().isoformat(),
        "source": "fazwaz.ru",
        "note": "Данные собраны с fazwaz.ru. Проверьте права на использование контента.",
        "count": len(items),
        "items": items,
    }
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    by_city = {}
    for it in items:
        by_city[it.get("city") or "—"] = by_city.get(it.get("city") or "—", 0) + 1
    print(f"\n✓ Готово: {args.out_json} ({len(items)} объектов)")
    for city, n in sorted(by_city.items(), key=lambda kv: -kv[1]):
        print(f"    {city}: {n}")
    print(f"✓ Изображения: {args.img_dir}")


if __name__ == "__main__":
    main()
