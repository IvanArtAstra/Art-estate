#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_rentals.py — страницы аренды Estate Art
=============================================

Читает data/rentals.json и собирает:
  arenda/index.html          — список объектов аренды
  arenda/<slug>/index.html   — страница объекта: цена в месяц, что входит,
                               платежи сверху, правила, фото

Стили, шапка и подвал берутся из шаблона страницы объекта (build_pages.PAGE),
чтобы аренда выглядела так же, как продажа. Sitemap собирает build_pages.py
(он читает тот же data/rentals.json).

Запуск:  python3 scraper/build_rentals.py
Новую квартиру добавляют записью в data/rentals.json (поля — как у первой).
"""

import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_pages import PAGE, RATES, SITE, esc, nsep, plural, _urlenc  # noqa: E402

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]
CLEANINGS_PER_MONTH = 2  # раз в две недели — для ориентировочной суммы

STYLE = re.search(r"<style>.*?</style>", PAGE, re.S).group(0)
FOOTER = re.search(r'<footer class="footer".*?</footer>', PAGE, re.S).group(0)
EXTRA_CSS = """<style>
  .rt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.4rem; }
  .rt-box { background: var(--cream, #fffdf8); border-radius: var(--radius); padding: 1.4rem 1.5rem; box-shadow: var(--shadow); }
  .rt-box h3 { font-size: 1.25rem; color: var(--teal); margin: 0 0 .8rem; }
  .rt-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .55rem; color: var(--ink-soft); }
  .rt-list li { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px solid rgba(20,32,31,.08); padding-bottom: .5rem; }
  .rt-list li:last-child { border-bottom: 0; padding-bottom: 0; }
  .rt-list b { color: var(--ink); text-align: right; font-weight: 600; }
  .rt-list--plain li { display: block; }
  .rt-list--stack li { display: block; }
  .rt-list--stack span { display: block; font-size: .88rem; }
  .rt-list--stack b { display: block; text-align: left; margin-top: .15rem; }
  .rt-total { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(20,32,31,.12); }
  .rt-total b { font-family: 'Cormorant Garamond', serif; font-size: 1.7rem; color: var(--ink); display: block; }
  .rt-total span { color: var(--ink-soft); font-size: .9rem; }
  .rt-note { color: var(--ink-soft); font-size: .9rem; margin-top: .8rem; }
</style>"""

DETAIL = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>__TITLE__ — аренда | Estate Art</title>
<meta name="description" content="__METADESC__" />
<meta name="theme-color" content="#0f3f3a" />
<link rel="canonical" href="__CANON__" />
<link rel="icon" type="image/svg+xml" href="../../assets/favicon.svg" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ru_RU" />
<meta property="og:site_name" content="Estate Art" />
<meta property="og:title" content="__TITLE__ — аренда, Estate Art" />
<meta property="og:description" content="__METADESC__" />
<meta property="og:url" content="__CANON__" />
<meta property="og:image" content="__OGIMG__" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="__OGIMG__" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../../css/styles.css" />
__STYLE__
__EXTRA_CSS__
<script type="application/ld+json">__JSONLD__</script>
</head>
<body>
<header class="pp-header">
  <a href="../../" class="logo" style="color:var(--teal)">ESTATE <span style="color:var(--gold)">ART</span></a>
  <a href="https://t.me/EstateArtHomesBot" class="header__cta" style="color:var(--teal);border-color:rgba(15,63,58,.3)" data-chat-open target="_blank" rel="noopener">Задать вопрос</a>
</header>

<div class="pp-wrap">
  <nav class="crumbs" aria-label="Хлебные крошки">
    <a href="../../">Главная</a> / <a href="../">Аренда</a> / <span>__TITLE__</span>
  </nav>

  <div class="pp-hero">
    <div class="pp-gallery">
      <div class="pp-media">
        <img id="ppMain" src="__IMG__" alt="__TITLE__ — фото" data-i="0" />
        <div class="pp-badges">__BADGES__</div>
      </div>
      <div class="pp-thumbs">__THUMBS__</div>
    </div>
    <div class="pp-info">
      <span class="pp-type">__TYPE__ · аренда</span>
      <h1 class="pp-title">__TITLE__</h1>
      <p class="pp-loc">__LOC__</p>
      <div class="pp-price">__PRICE__ <small style="font-size:1rem;font-family:'Manrope',sans-serif;font-weight:500;color:var(--ink-soft)">в месяц</small></div>
      <p class="pp-price-sub">__PRICE_SUB__</p>
      <div class="detail__specs" style="margin-bottom:1.4rem">__SPECS__</div>
      <div class="pp-actions">
        <a class="btn btn--wa" href="__WA__" target="_blank" rel="noopener">Снять · WhatsApp</a>
        <a class="btn btn--tg" href="https://t.me/+79124869508" target="_blank" rel="noopener">Telegram</a>
      </div>
    </div>
  </div>

  <div class="pp-section"><h2>Описание</h2><p class="pp-desc">__DESC__</p></div>

  <div class="pp-section">
    <h2>Условия аренды</h2>
    <div class="rt-grid">
      <div class="rt-box"><h3>Входит в цену</h3><ul class="rt-list rt-list--plain">__INCLUDED__</ul></div>
      <div class="rt-box"><h3>Платежи сверху</h3><ul class="rt-list rt-list--stack">__EXTRAS__</ul></div>
      <div class="rt-box"><h3>Правила</h3><ul class="rt-list rt-list--plain">__RULES__</ul></div>
    </div>
    __TOTAL__
  </div>

  <a class="pp-back" href="../">← Вся аренда</a>
</div>

<div class="lb" id="lb" hidden>
  <button class="lb__btn lb__close" id="lbClose" aria-label="Закрыть">×</button>
  <button class="lb__btn lb__prev" id="lbPrev" aria-label="Предыдущее">‹</button>
  <img id="lbImg" src="" alt="Фото объекта" />
  <button class="lb__btn lb__next" id="lbNext" aria-label="Следующее">›</button>
</div>

__FOOTER__

<script>
(function(){
  var $=function(id){return document.getElementById(id);};
  var IMAGES=__IMAGES_JS__, idx=0;
  var main=$('ppMain'), lb=$('lb'), lbImg=$('lbImg');
  function setMain(i){ idx=i; if(main&&IMAGES[i])main.src=IMAGES[i]; document.querySelectorAll('.pp-thumb').forEach(function(t,k){t.classList.toggle('is-active',k===i);}); }
  function showLb(i){ if(!IMAGES.length)return; idx=(i+IMAGES.length)%IMAGES.length; lbImg.src=IMAGES[idx]; lb.hidden=false; }
  document.querySelectorAll('.pp-thumb').forEach(function(t){ t.addEventListener('click',function(){ setMain(+t.dataset.i); }); });
  main&&main.addEventListener('click',function(){ showLb(idx); });
  $('lbClose')&&$('lbClose').addEventListener('click',function(){ lb.hidden=true; });
  $('lbPrev')&&$('lbPrev').addEventListener('click',function(){ showLb(idx-1); });
  $('lbNext')&&$('lbNext').addEventListener('click',function(){ showLb(idx+1); });
  lb&&lb.addEventListener('click',function(e){ if(e.target===lb)lb.hidden=true; });
  document.addEventListener('keydown',function(e){ if(lb.hidden)return; if(e.key==='Escape')lb.hidden=true; else if(e.key==='ArrowLeft')showLb(idx-1); else if(e.key==='ArrowRight')showLb(idx+1); });
})();
</script>
</body>
</html>
"""

LISTING = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Аренда квартир в Дананге | Estate Art</title>
<meta name="description" content="__METADESC__" />
<meta name="theme-color" content="#0f3f3a" />
<link rel="canonical" href="__CANON__" />
<link rel="icon" type="image/svg+xml" href="../assets/favicon.svg" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ru_RU" />
<meta property="og:site_name" content="Estate Art" />
<meta property="og:title" content="Аренда квартир в Дананге — Estate Art" />
<meta property="og:description" content="__METADESC__" />
<meta property="og:url" content="__CANON__" />
<meta property="og:image" content="__OGIMG__" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../css/styles.css" />
<style>
  body { background: var(--sand); }
  .pp-header { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 1rem clamp(1.2rem,4vw,3rem); background: rgba(246,241,231,.92); backdrop-filter: blur(14px); border-bottom: 1px solid rgba(20,32,31,.08); }
  .pp-wrap { max-width: 1180px; margin: 0 auto; padding: clamp(1.4rem,4vw,2.6rem); }
  .crumbs { font-size: .85rem; color: var(--ink-soft); margin: .4rem 0 1.2rem; }
  .crumbs a { color: var(--ink-soft); } .crumbs a:hover { color: var(--gold); } .crumbs span { color: var(--gold); }
  .d-intro h1 { font-size: clamp(2rem,5vw,3.2rem); color: var(--teal); margin-bottom: .5rem; }
  .d-intro > p:not(.eyebrow) { color: var(--ink-soft); font-size: 1.1rem; max-width: 760px; margin-bottom: 2rem; }
  .pp-back { display: inline-flex; gap: .4rem; color: var(--teal); font-weight: 700; margin-top: 2.4rem; }
</style>
<script type="application/ld+json">__JSONLD__</script>
</head>
<body>
<header class="pp-header">
  <a href="../" class="logo" style="color:var(--teal)">ESTATE <span style="color:var(--gold)">ART</span></a>
  <a href="https://t.me/EstateArtHomesBot" class="header__cta" style="color:var(--teal);border-color:rgba(15,63,58,.3)" data-chat-open target="_blank" rel="noopener">Задать вопрос</a>
</header>
<div class="pp-wrap">
  <nav class="crumbs"><a href="../">Главная</a> / <span>Аренда</span></nav>
  <div class="d-intro">
    <p class="eyebrow">Вьетнам</p>
    <h1>Аренда квартир в Дананге</h1>
    <p>__INTRO__</p>
  </div>
  <div class="catalog__grid">__CARDS__</div>
  <a class="pp-back" href="../">← На главную</a>
</div>
__FOOTER__
</body>
</html>
"""


def fmt_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {MONTHS[m - 1]} {y}"


def vnd(n):
    return nsep(n) + " ₫"


def li(text):
    return f"<li>{esc(text)}</li>"


def build_detail(it, root, year):
    slug, canon = it["slug"], f"{SITE}/{it['url']}"
    vnd_m, usd_m = it["rentMonthVND"], it.get("rentMonthUSD")
    gallery = ["../../" + p for p in it["images"]]
    thumbs = "".join(
        f'<button class="pp-thumb{" is-active" if i == 0 else ""}" data-i="{i}" type="button">'
        f'<img src="{esc(u)}" alt="" loading="lazy"></button>' for i, u in enumerate(gallery)
    ) if len(gallery) > 1 else ""

    sub = []
    if usd_m:
        sub += [f"≈ ${nsep(usd_m)}", nsep(usd_m * RATES["RUB"]) + " ₽", nsep(usd_m * RATES["THB"]) + " ฿"]

    badges = ""
    if it.get("availableFrom"):
        badges = f'<span class="badge badge--yield">Свободно с {fmt_date(it["availableFrom"])}</span>'

    specs = [f'<div class="spec"><span>Тип</span><b>{esc(it["type"])}</b></div>',
             f'<div class="spec"><span>Площадь</span><b>{esc(it["area"])} м²</b></div>']
    if it.get("floor"):
        specs.append(f'<div class="spec"><span>Этаж</span><b>{esc(it["floor"])}</b></div>')
    if it.get("view"):
        specs.append(f'<div class="spec"><span>Вид</span><b>{esc(it["view"])}</b></div>')
    specs.append(f'<div class="spec"><span>Кухня</span><b>{"есть" if it.get("kitchen") else "нет"}</b></div>')
    if it.get("washingMachine") is not None:
        specs.append(f'<div class="spec"><span>Стиральная машина</span><b>{"есть" if it["washingMachine"] else "нет"}</b></div>')

    extras = "".join(f'<li><span>{esc(e["label"])}</span><b>{esc(e["value"])}</b></li>' for e in it.get("extras", []))

    # Ориентир на одного человека без электричества: аренда + УК + вода + уборки
    total = ""
    if all(it.get(k) for k in ("mgmtVND", "waterVND", "cleaningVND")):
        mgmt, water, clean = it["mgmtVND"], it["waterVND"], it["cleaningVND"]
        approx = vnd_m + mgmt + water + clean * CLEANINGS_PER_MONTH
        total = (f'<div class="rt-box rt-total"><span>Ориентир на одного человека в месяц, без электричества</span>'
                 f'<b>≈ {vnd(approx)}</b>'
                 f'<p class="rt-note">Аренда {vnd(vnd_m)} + управляющая компания {vnd(mgmt)} + вода {vnd(water)} + '
                 f'{CLEANINGS_PER_MONTH} {plural(CLEANINGS_PER_MONTH, "уборка", "уборки", "уборок")} по {vnd(clean)}. '
                 f'Электричество считается по счётчику.</p></div>')

    desc = it["description"]
    meta = esc(f"{it['title']}: {vnd(vnd_m)} в месяц"
               + (f" (≈ ${nsep(usd_m)})" if usd_m else "")
               + f". {it['type']} {it['area']} м², Дананг. "
               + ("Бассейн, парковка и вайфай включены." if it.get("included") else ""))
    og = f"{SITE}/{it['image']}"
    wa = "https://wa.me/79124869508?text=" + _urlenc(
        "Здравствуйте! Интересует аренда «" + it["title"] + "» с сайта Estate Art.")

    jsonld = json.dumps({
        "@context": "https://schema.org", "@type": "Product",
        "name": it["title"], "image": [og], "description": desc, "category": it["type"],
        "offers": {
            "@type": "Offer", "priceCurrency": "VND", "price": vnd_m, "url": canon,
            "availability": "https://schema.org/InStock",
            "availabilityStarts": it.get("availableFrom"),
            "priceSpecification": {"@type": "UnitPriceSpecification", "price": vnd_m,
                                   "priceCurrency": "VND", "unitCode": "MON"},
        },
    }, ensure_ascii=False)
    crumbs = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Главная", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Аренда", "item": SITE + "/arenda/"},
            {"@type": "ListItem", "position": 3, "name": it["title"], "item": canon},
        ],
    }, ensure_ascii=False)

    html = DETAIL
    for k, v in {
        "__STYLE__": STYLE, "__EXTRA_CSS__": EXTRA_CSS, "__FOOTER__": FOOTER,
        "__TITLE__": esc(it["title"]), "__METADESC__": meta, "__CANON__": canon, "__OGIMG__": og,
        "__IMG__": esc(gallery[0]), "__THUMBS__": thumbs, "__IMAGES_JS__": json.dumps(gallery),
        "__TYPE__": esc(it["type"]), "__LOC__": esc(it["location"]),
        "__PRICE__": vnd(vnd_m), "__PRICE_SUB__": " · ".join(sub), "__BADGES__": badges,
        "__SPECS__": "".join(specs), "__DESC__": esc(desc),
        "__INCLUDED__": "".join(li(x) for x in it.get("included", [])),
        "__EXTRAS__": extras, "__RULES__": "".join(li(x) for x in it.get("rules", [])),
        "__TOTAL__": total, "__WA__": esc(wa),
        "__JSONLD__": f'{jsonld}</script>\n<script type="application/ld+json">{crumbs}',
        "__YEAR__": str(year),
    }.items():
        html = html.replace(k, v)

    out = os.path.join(root, "arenda", slug)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  ✓ arenda/{slug}/")


def build_listing(items, root, year):
    cards = []
    for it in items:
        meta = [f"{esc(it['area'])} м²"]
        if it.get("floor"):
            meta.append(f"{esc(it['floor'])} этаж")
        if it.get("availableFrom"):
            meta.append(f"с {fmt_date(it['availableFrom'])}")
        usd = f'<span class="card__ppm">≈ ${nsep(it["rentMonthUSD"])}</span>' if it.get("rentMonthUSD") else ""
        cards.append(
            f'<article class="card"><div class="card__media"><img class="is-loaded" src="../{esc(it["image"])}" alt="{esc(it["title"])}" loading="lazy"/>'
            f'<span class="card__tag">{esc(it["type"])}</span></div>'
            f'<div class="card__body"><span class="card__price">{vnd(it["rentMonthVND"])} <small>в месяц</small></span>'
            f'<h3>{esc(it["title"])}</h3><p class="card__meta">{esc(it["location"])} · {" · ".join(meta)}</p>'
            f'<div class="card__bottom">{usd}'
            f'<a class="card__link" href="../{esc(it["url"])}">Подробнее <span class="card__arrow">→</span></a></div></div></article>'
        )
    n = len(items)
    intro = ("Квартиры в аренду в Дананге. На странице каждой — цена за месяц, что в неё входит, "
             "какие платежи идут сверху и по каким правилам сдаётся жильё.")
    meta = esc(f"Аренда квартир в Дананге: {n} {plural(n, 'объект', 'объекта', 'объектов')}, "
               "цена за месяц и платежи сверху. Estate Art.")
    canon = f"{SITE}/arenda/"
    jsonld = json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Главная", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Аренда", "item": canon},
    ]}, ensure_ascii=False)
    html = LISTING
    for k, v in {
        "__FOOTER__": FOOTER.replace('href="../../', 'href="../'),
        "__METADESC__": meta, "__CANON__": canon, "__OGIMG__": f"{SITE}/{items[0]['image']}",
        "__INTRO__": esc(intro), "__CARDS__": "".join(cards), "__JSONLD__": jsonld, "__YEAR__": str(year),
    }.items():
        html = html.replace(k, v)
    os.makedirs(os.path.join(root, "arenda"), exist_ok=True)
    with open(os.path.join(root, "arenda", "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  ▸ arenda/ ({n})")


def build():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = json.load(open(os.path.join(root, "data", "rentals.json"), encoding="utf-8"))
    items = [i for i in data.get("items", []) if i.get("slug")]
    if not items:
        print("В data/rentals.json нет объектов со slug — нечего собирать.")
        return
    year = dt.date.today().year
    for it in items:
        build_detail(it, root, year)
    build_listing(items, root, year)
    print(f"\n✓ Аренда: {len(items)} {plural(len(items), 'объект', 'объекта', 'объектов')}")


if __name__ == "__main__":
    build()
