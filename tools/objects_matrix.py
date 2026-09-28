#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Матрица объектов Estate Art: реестр всего, что когда-либо попадало в каталог,
и проверка, живы ли объявления сейчас.

Зачем. Каталог — это срез на момент сбора. Объекты снимают с продажи, цены
двигают, ссылки умирают. Матрица помнит каждый объект с датой первого появления
и историей цены, поэтому в любой момент можно спросить «что устарело» и получить
ответ, а не пересобирать каталог вслепую.

    python3 tools/objects_matrix.py sync     # внести каталог в матрицу
    python3 tools/objects_matrix.py check    # сходить на источник и сверить
    python3 tools/objects_matrix.py report   # показать состояние, без сети

Статусы объекта:
    live              объявление на месте, цена та же
    price-changed     объявление на месте, цена изменилась (записано в priceHistory)
    currency-changed  площадка сменила валюту показа — сравнивать проценты нельзя
    gone              страница объявления больше не отдаётся
    unchecked         ещё ни разу не проверяли

Про валюту. Источник показывает цены то в тенге, то в донгах, то в батах,
и меняет это со временем: осенью 2026 Пхукет переехал с KZT на VND. Поэтому
сверка идёт по исходной строке цены и её валюте, а не по пересчитанным долларам —
иначе смена валюты выглядела бы как обвал цены. Если валюта сменилась, объект
помечается currency-changed и процент не считается.

Ключи check:
    --stale-days N   проверять только то, что не проверяли N дней (по умолчанию 7)
    --limit N        ограничить число проверок за запуск
    --all            проверить всё, игнорируя --stale-days
    --delay СЕК      пауза между запросами (по умолчанию 1.0)
    --apply          записать свежие цены обратно в catalog.json и убрать
                     оттуда снятые с продажи объекты
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scraper"))

import requests  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "catalog.json")
MATRIX = os.path.join(ROOT, "data", "objects-matrix.json")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE = "https://www.fazwaz.ru"
MARKER_RE = re.compile(
    r'<script type="application/json" id="search-marker-payloads">(.*?)</script>', re.S)

# Те же категории, что у парсера: матрица сверяется по ним же
REGIONS = {
    "Пхукет": "/недвижимость-продажа/таиланд/пхукет",
    "Дананг": "/недвижимость-продажа/вьетнам/дананг",
    "Нячанг": "/недвижимость-продажа/вьетнам/khanh-hoa/nha-trang",
}

TODAY = dt.date.today().isoformat()


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})
    return s


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def new_matrix():
    return {
        "updated": TODAY,
        "note": ("Реестр объектов: что когда появилось, по какой цене и живо ли сейчас. "
                 "Обновляется командами sync и check из tools/objects_matrix.py."),
        "objects": [],
    }


# ---------------------------------------------------------------- sync
def cmd_sync(args):
    catalog = load(CATALOG, None)
    if not catalog:
        sys.exit("Нет data/catalog.json — сначала соберите каталог.")
    matrix = load(MATRIX, new_matrix())
    index = {o["id"]: o for o in matrix["objects"]}

    added = updated = 0
    in_catalog = set()
    for it in catalog.get("items", []):
        oid = str(it.get("id"))
        in_catalog.add(oid)
        price = it.get("priceUSD")
        rec = index.get(oid)
        if not rec:
            rec = {
                "id": oid,
                "title": it.get("title"),
                "country": it.get("country"),
                "city": it.get("city"),
                "district": (it.get("location") or "").split(",")[0].strip(),
                "type": it.get("type"),
                "beds": it.get("beds"),
                "area": it.get("area"),
                "priceUSD": price,
                "priceOriginal": it.get("priceOriginal"),
                "pageUrl": it.get("url"),
                "sourceUrl": it.get("source_url"),
                "firstSeen": TODAY,
                "lastChecked": None,
                "lastSeenInCatalog": TODAY,
                "status": "unchecked",
                "priceHistory": ([{"date": TODAY, "usd": price,
                                   "raw": it.get("priceOriginal")}] if price else []),
            }
            matrix["objects"].append(rec)
            index[oid] = rec
            added += 1
        else:
            rec["lastSeenInCatalog"] = TODAY
            # цена могла измениться при пересборе каталога — фиксируем
            if price and rec.get("priceUSD") != price:
                rec.setdefault("priceHistory", []).append(
                    {"date": TODAY, "usd": price, "raw": it.get("priceOriginal")})
                rec["priceUSD"] = price
                rec["priceOriginal"] = it.get("priceOriginal")
                rec["status"] = "price-changed"
                updated += 1
            for k, v in (("title", it.get("title")), ("city", it.get("city")),
                         ("pageUrl", it.get("url")), ("sourceUrl", it.get("source_url"))):
                if v:
                    rec[k] = v

    dropped = [o for o in matrix["objects"]
               if o["id"] not in in_catalog and o.get("lastSeenInCatalog") != TODAY]
    matrix["updated"] = TODAY
    save(MATRIX, matrix)

    print(f"Матрица: {len(matrix['objects'])} объектов")
    print(f"  добавлено новых:        {added}")
    print(f"  цена изменилась:        {updated}")
    print(f"  нет в текущем каталоге: {len(dropped)}")
    if dropped:
        for o in dropped[:8]:
            print(f"    · {o['title'][:44]:46} последний раз в каталоге {o.get('lastSeenInCatalog')}")
        if len(dropped) > 8:
            print(f"    … и ещё {len(dropped) - 8}")


# ---------------------------------------------------------------- check
def fetch_listing_prices(s, delay, pages=8):
    """{id: цена-строкой} со страниц листинга. Дешевле, чем ходить по объявлениям."""
    found = {}
    for city, category in REGIONS.items():
        for page in range(1, pages + 1):
            url = BASE + category + ("" if page == 1 else f"?page={page}")
            try:
                r = s.get(url, timeout=30)
                r.raise_for_status()
            except requests.RequestException:
                break
            m = MARKER_RE.search(r.text)
            if not m:
                break
            try:
                payload = json.loads(m.group(1))
            except json.JSONDecodeError:
                break
            if not payload:
                break
            for uid, obj in payload.items():
                if isinstance(obj, dict):
                    found[str(uid)] = obj.get("price")
            time.sleep(delay)
    return found


def cmd_check(args):
    matrix = load(MATRIX, None)
    if not matrix or not matrix["objects"]:
        sys.exit("Матрица пуста — сначала запустите sync.")

    cutoff = (dt.date.today() - dt.timedelta(days=args.stale_days)).isoformat()
    todo = [o for o in matrix["objects"]
            if args.all or not o.get("lastChecked") or o["lastChecked"] < cutoff]
    if args.limit:
        todo = todo[: args.limit]
    if not todo:
        print(f"Всё проверено за последние {args.stale_days} дн. Нечего делать.")
        return

    print(f"К проверке: {len(todo)} из {len(matrix['objects'])}")
    s = session()

    print("Снимаю текущие цены с листингов…")
    live_prices = fetch_listing_prices(s, args.delay)
    print(f"  в листингах сейчас: {len(live_prices)} объявлений")

    # Локальный импорт: разбор цены живёт в парсере, дублировать его не нужно
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "sf", os.path.join(ROOT, "scraper", "scrape_fazwaz.py"))
    sf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sf)

    stats = {"live": 0, "price-changed": 0, "currency-changed": 0, "gone": 0, "unknown": 0}
    changes, gone, currency = [], [], []

    for i, o in enumerate(todo, 1):
        oid = o["id"]
        raw = live_prices.get(oid)
        status = None

        if raw:
            amount, cur = sf.parse_price(raw)
            usd = sf.to_usd(amount, cur)
            was_raw = o.get("priceOriginal")
            was_amount, was_cur = sf.parse_price(was_raw) if was_raw else (None, None)

            if was_cur and cur and was_cur != cur:
                # Площадка переключила валюту показа. Проценты тут считать нельзя:
                # разница будет в основном от курса, а не от движения цены.
                o.setdefault("priceHistory", []).append({"date": TODAY, "usd": usd, "raw": raw})
                currency.append((o["title"], was_raw, raw, o.get("priceUSD"), usd))
                o["priceUSD"], o["priceOriginal"] = usd, raw
                status = "currency-changed"
            elif was_amount and amount and was_amount != amount:
                pct = (amount - was_amount) / was_amount * 100
                o.setdefault("priceHistory", []).append({"date": TODAY, "usd": usd, "raw": raw})
                changes.append((o["title"], o["priceUSD"], usd, pct))
                o["priceUSD"], o["priceOriginal"] = usd, raw
                status = "price-changed"
            else:
                # Цена в исходной валюте та же. Доллары могли разойтись, если
                # поменяли курс в RATES_TO_USD — подтянем, но это не движение цены.
                if usd and usd != o.get("priceUSD"):
                    o["priceUSD"] = usd
                status = "live"
        else:
            # В листинге не нашлось — это ещё не значит «снято»: объявление
            # могло уехать на дальние страницы. Проверяем саму страницу.
            url = o.get("sourceUrl")
            if not url:
                status = "unknown"
            else:
                try:
                    r = s.get(url, timeout=30, allow_redirects=True)
                    status = "gone" if r.status_code in (404, 410) else "live"
                except requests.RequestException:
                    status = "unknown"
                time.sleep(args.delay)
            if status == "gone":
                gone.append(o["title"])

        o["status"] = status
        o["lastChecked"] = TODAY
        stats[status] = stats.get(status, 0) + 1
        if i % 20 == 0:
            print(f"  …{i}/{len(todo)}")

    matrix["updated"] = TODAY
    matrix["lastCheck"] = {"date": TODAY, "checked": len(todo), **stats}
    save(MATRIX, matrix)

    if args.apply:
        # Сайт показывает цены из catalog.json — без этого шага проверка
        # остаётся знанием в матрице, а посетитель видит старые цифры.
        catalog = load(CATALOG, None)
        if catalog:
            fresh = {o["id"]: o for o in todo}
            dead = {o["id"] for o in todo if o.get("status") == "gone"}
            kept, fixed = [], 0
            for it in catalog.get("items", []):
                oid = str(it.get("id"))
                if oid in dead:
                    continue
                o = fresh.get(oid)
                if o and o.get("priceUSD") and it.get("priceUSD") != o["priceUSD"]:
                    it["priceUSD"] = o["priceUSD"]
                    it["priceOriginal"] = o.get("priceOriginal")
                    it["priceLabel"] = "$" + f"{o['priceUSD']:,}".replace(",", " ")
                    if it.get("area"):
                        it["pricePerM2"] = round(o["priceUSD"] / it["area"])
                    # старая цена и скидка считались от прежней стоимости — сбрасываем
                    it["oldPriceUSD"] = it["oldPriceLabel"] = it["discountPct"] = None
                    fixed += 1
                kept.append(it)
            catalog["items"], catalog["count"] = kept, len(kept)
            save(CATALOG, catalog)
            print(f"\nВ catalog.json: обновлено цен {fixed}, удалено снятых {len(dead)}, "
                  f"осталось объектов {len(kept)}")
            if dead:
                print("Перегенерируйте страницы: python3 scraper/build_pages.py")

    print(f"\nПроверено {len(todo)}:")
    print(f"  на месте, цена та же:  {stats.get('live', 0)}")
    print(f"  цена изменилась:       {stats.get('price-changed', 0)}")
    print(f"  сменилась валюта:      {stats.get('currency-changed', 0)}")
    print(f"  снято с продажи:       {stats.get('gone', 0)}")
    print(f"  не удалось проверить:  {stats.get('unknown', 0)}")

    if changes:
        print("\nИзменения цены (в исходной валюте объявления):")
        for title, was, now, pct in sorted(changes, key=lambda c: -abs(c[3]))[:15]:
            print(f"  {title[:40]:42} ${was:>9,} → ${now:>9,}  {pct:+.1f}%")
    if currency:
        print("\nПлощадка сменила валюту показа — процент тут не считается:")
        for title, was_raw, raw, was_usd, usd in currency[:15]:
            print(f"  {title[:34]:36} {was_raw:>18} → {raw:<18} (${was_usd or 0:,} → ${usd or 0:,})")
        print("  Проверьте курсы в RATES_TO_USD в scraper/scrape_fazwaz.py — они заданы вручную.")
    if gone:
        print("\nСняты с продажи:")
        for title in gone[:15]:
            print(f"  · {title[:60]}")
        print("\nЭти объекты остались в каталоге. Уберите их вручную из data/catalog.json\n"
              "или пересоберите каталог парсером.")


# ---------------------------------------------------------------- report
def cmd_report(args):
    matrix = load(MATRIX, None)
    if not matrix:
        sys.exit("Матрицы ещё нет — запустите sync.")
    objs = matrix["objects"]
    import collections
    by_status = collections.Counter(o.get("status") for o in objs)
    by_city = collections.Counter(o.get("city") for o in objs)

    print(f"Матрица от {matrix.get('updated')}: {len(objs)} объектов")
    print("\nПо городам:")
    for city, n in by_city.most_common():
        print(f"  {city or '—':12} {n}")
    print("\nПо состоянию:")
    for st, n in by_status.most_common():
        print(f"  {st or 'unchecked':14} {n}")

    last = matrix.get("lastCheck")
    print(f"\nПоследняя проверка: {last['date']} ({last['checked']} объектов)" if last
          else "\nПроверок ещё не было — запустите check.")

    stale = [o for o in objs if not o.get("lastChecked")]
    if stale:
        print(f"Ни разу не проверялись: {len(stale)}")

    moved = [o for o in objs if len(o.get("priceHistory") or []) > 1]
    if moved:
        print(f"\nЦена менялась у {len(moved)} объектов:")
        for o in moved[:10]:
            h = o["priceHistory"]
            print(f"  {o['title'][:40]:42} ${h[0]['usd']:>9,} → ${h[-1]['usd']:>9,}")


def main():
    ap = argparse.ArgumentParser(description="Матрица объектов Estate Art")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("sync", help="внести текущий каталог в матрицу")

    c = sub.add_parser("check", help="сходить на источник и сверить цены и доступность")
    c.add_argument("--stale-days", type=int, default=7,
                   help="проверять то, что не проверяли N дней (по умолчанию 7)")
    c.add_argument("--limit", type=int, default=0, help="максимум проверок за запуск")
    c.add_argument("--all", action="store_true", help="проверить всё, игнорируя --stale-days")
    c.add_argument("--delay", type=float, default=1.0, help="пауза между запросами, сек")
    c.add_argument("--apply", action="store_true",
                   help="записать свежие цены в catalog.json и убрать снятые объекты")

    sub.add_parser("report", help="показать состояние матрицы, без сети")

    args = ap.parse_args()
    {"sync": cmd_sync, "check": cmd_check, "report": cmd_report}[args.cmd](args)


if __name__ == "__main__":
    main()
