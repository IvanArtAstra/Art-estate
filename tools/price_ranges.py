#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Диапазоны цен по районам — то немногое о деньгах, что ИИ-менеджер говорит вслух.

Конкретную цену объекта он не называет: каталог — это снимок парсинга, часть
объектов уже могла уйти или подорожать, и названная цифра стала бы обещанием,
которое некому выполнить. Диапазон по району такого обещания не даёт, но и не
выглядит уклончивым: «в Банг Тао квартиры от 180 до 400 тысяч» — рабочий ответ.

    python3 tools/price_ranges.py

Кладёт data/price-ranges.json: компактная таблица, которую воркер тянет с сайта
и держит в кэше. Пересобирать после каждого обновления каталога.
"""
import io
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "catalog.json")
OUT = os.path.join(ROOT, "data", "price-ranges.json")

MIN_SAMPLE = 3   # меньше трёх объектов — это не диапазон, а два случайных числа


def district(it):
    loc = (it.get("location") or "").split(",")[0].strip()
    return loc or None


def bucket(items):
    prices = sorted(int(it["priceUSD"]) for it in items if it.get("priceUSD"))
    areas = sorted(float(it["area"]) for it in items if it.get("area"))
    if len(prices) < MIN_SAMPLE:
        return None
    mid = prices[len(prices) // 2]
    out = {"n": len(prices), "min": prices[0], "max": prices[-1], "mid": mid}
    ppm = sorted(round(it["priceUSD"] / it["area"])
                 for it in items if it.get("priceUSD") and it.get("area"))
    if len(ppm) >= MIN_SAMPLE:
        out["ppm"] = ppm[len(ppm) // 2]
    if areas:
        out["area_min"] = round(areas[0])
        out["area_max"] = round(areas[-1])
    return out


def main():
    catalog = json.loads(io.open(CATALOG, encoding="utf-8").read())
    items = [it for it in catalog.get("items", []) if it.get("priceUSD")]

    by_city = defaultdict(list)
    by_district = defaultdict(list)
    by_type = defaultdict(list)
    for it in items:
        if it.get("city"):
            by_city[it["city"]].append(it)
        d = district(it)
        if d:
            by_district[(it.get("city") or "", d)].append(it)
        if it.get("type"):
            by_type[((it.get("city") or ""), it["type"])].append(it)

    data = {
        "updated": catalog.get("updated"),
        "note": ("Снимок каталога на дату updated, а не оферта. Это ориентир "
                 "по рынку, точная цена подтверждается агентом."),
        "total": len(items),
        "cities": {},
        "districts": {},
        "types": {},
    }
    for city, lst in sorted(by_city.items()):
        b = bucket(lst)
        if b:
            data["cities"][city] = b
    for (city, d), lst in sorted(by_district.items()):
        b = bucket(lst)
        if b:
            data["districts"]["%s|%s" % (city, d)] = b
    for (city, t), lst in sorted(by_type.items()):
        b = bucket(lst)
        if b:
            data["types"]["%s|%s" % (city, t)] = b

    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print("data/price-ranges.json: %d городов, %d районов, %d связок город+тип, "
          "из %d объектов с ценой"
          % (len(data["cities"]), len(data["districts"]), len(data["types"]), len(items)))
    for city, b in data["cities"].items():
        print("  %-10s %d объектов, $%s–$%s, медиана $%s"
              % (city, b["n"], f'{b["min"]:,}', f'{b["max"]:,}', f'{b["mid"]:,}'))


if __name__ == "__main__":
    main()
