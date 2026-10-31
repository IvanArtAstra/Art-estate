#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Структурированные данные для главной страницы.

Собирает schema.org-разметку из того, что реально есть на сайте: организация
и зона работы, поиск по каталогу, вопросы-ответы из секции FAQ, список объектов
из catalog.json. Вставляет её в index.html между маркерами, поэтому запускать
можно сколько угодно раз — блок заменяется, а не дублируется.

    python3 tools/seo_schema.py

Зачем это нужно: поисковики и ИИ-ассистенты читают разметку, а не догадываются
по вёрстке. Без неё сайт для них — просто текст.
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
CATALOG = os.path.join(ROOT, "data", "catalog.json")
SITE = "https://ivanartastra.github.io/Art-estate"

BEGIN = "  <!-- schema:begin — генерируется tools/seo_schema.py, руками не править -->"
END = "  <!-- schema:end -->"

PHONE = "+79124869508"
AGENT = "Артемьева Алена Николаевна"

CITY_GEO = {
    "Пхукет": ("Phuket", "TH", 7.8804, 98.3923),
    "Дананг": ("Da Nang", "VN", 16.0545, 108.2022),
    "Нячанг": ("Nha Trang", "VN", 12.2388, 109.1967),
    "Фукуок": ("Phu Quoc", "VN", 10.2270, 103.9670),
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def faq_from_index(idx):
    """Вопросы и ответы берём из живой секции FAQ, чтобы разметка не разошлась с текстом."""
    out = []
    for m in re.finditer(
        r'<details class="faq__item">\s*<summary>(.*?)</summary>\s*<p>(.*?)</p>', idx, re.S):
        q = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).replace(" ", " ").strip()
        a = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).replace(" ", " ").strip()
        a = re.sub(r"\s+", " ", a)
        if q and a:
            out.append({
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            })
    return out


def build(idx, catalog):
    items = catalog.get("items", [])
    cities = []
    seen = set()
    for it in items:
        c = it.get("city")
        if c and c not in seen and c in CITY_GEO:
            seen.add(c)
            en, country, lat, lng = CITY_GEO[c]
            cities.append({
                "@type": "City", "name": c, "alternateName": en,
                "address": {"@type": "PostalAddress", "addressLocality": en, "addressCountry": country},
                "geo": {"@type": "GeoCoordinates", "latitude": lat, "longitude": lng},
            })

    org = {
        "@type": "RealEstateAgent",
        "@id": f"{SITE}/#org",
        "name": "Estate Art",
        "url": SITE + "/",
        "description": ("Подбор и сопровождение покупки вилл и квартир на Пхукете, "
                        "в Дананге и Нячанге. Юридическая проверка, безопасные расчёты, "
                        "сопровождение сделки удалённо."),
        "image": f"{SITE}/assets/hero-phuket.jpg",
        "logo": f"{SITE}/assets/favicon.svg",
        "telephone": PHONE,
        "areaServed": cities,
        "knowsLanguage": ["ru", "en", "th"],
        "founder": {"@type": "Person", "name": AGENT, "jobTitle": "Персональный агент по недвижимости"},
        "employee": {"@type": "Person", "name": AGENT},
        "contactPoint": [{
            "@type": "ContactPoint", "telephone": PHONE, "contactType": "sales",
            "availableLanguage": ["Russian", "English"],
            "areaServed": ["TH", "VN"],
        }],
        "sameAs": [
            f"https://wa.me/{PHONE.lstrip('+')}",
            f"https://t.me/{PHONE}",
            "https://t.me/IISoSArt",
            "https://t.me/IvanArtxJarvis",
        ],
        "makesOffer": {
            "@type": "Offer",
            "itemOffered": {"@type": "Service", "name": "Бесплатная консультация по переезду во Вьетнам и Таиланд"},
            "price": "0", "priceCurrency": "USD",
        },
    }

    website = {
        "@type": "WebSite",
        "@id": f"{SITE}/#website",
        "url": SITE + "/",
        "name": "Estate Art",
        "inLanguage": "ru-RU",
        "publisher": {"@id": f"{SITE}/#org"},
        "potentialAction": {
            "@type": "SearchAction",
            "target": {"@type": "EntryPoint", "urlTemplate": f"{SITE}/?q={{search_term_string}}#catalog"},
            "query-input": "required name=search_term_string",
        },
    }

    graph = [org, website]

    faq = faq_from_index(idx)
    if faq:
        graph.append({"@type": "FAQPage", "@id": f"{SITE}/#faq", "mainEntity": faq})

    # Список объектов: поисковику и ассистенту видно, что в каталоге, без разбора вёрстки
    listed = [it for it in items if it.get("url") and it.get("priceUSD")][:30]
    if listed:
        graph.append({
            "@type": "ItemList",
            "@id": f"{SITE}/#catalog",
            "name": "Каталог объектов Estate Art",
            "numberOfItems": len(items),
            "itemListElement": [{
                "@type": "ListItem", "position": n,
                "url": f"{SITE}/{it['url']}",
                "name": it.get("title"),
            } for n, it in enumerate(listed, 1)],
        })

    return {"@context": "https://schema.org", "@graph": graph}, len(faq), len(listed)


def main():
    idx = read(INDEX)
    catalog = json.loads(read(CATALOG))
    data, n_faq, n_items = build(idx, catalog)

    block = (BEGIN + '\n  <script type="application/ld+json">'
             + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
             + "</script>\n" + END)

    if BEGIN in idx and END in idx:
        idx = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: block, idx, flags=re.S)
        action = "обновлён"
    else:
        anchor = '  <link rel="stylesheet" href="css/styles.css" />'
        if anchor not in idx:
            sys.exit("Не нашёл, куда вставить блок разметки в index.html")
        idx = idx.replace(anchor, anchor + "\n\n" + block, 1)
        action = "добавлен"

    with open(INDEX, "w", encoding="utf-8") as f:
        f.write(idx)

    print(f"Блок schema.org {action}: организация, сайт, FAQ ({n_faq} вопросов), "
          f"каталог ({n_items} из {len(catalog.get('items', []))} объектов)")


if __name__ == "__main__":
    main()
