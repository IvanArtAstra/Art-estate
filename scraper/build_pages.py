#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_pages.py — генерация статических SEO-страниц объектов Art Estate
=====================================================================

Читает data/catalog.json и для каждого объекта создаёт человекочитаемую
страницу object/<slug>/index.html с уникальными мета-тегами, OpenGraph,
schema.org-разметкой, breadcrumbs, характеристиками, калькуляторами и картой.
Дописывает в каждый объект catalog.json поля slug/url и формирует sitemap.xml.

Запуск:  python3 scraper/build_pages.py
Обычно вызывается после парсера (см. scraper/update-catalog.sh).
"""

import json
import os
import re
import datetime as dt

SITE = "https://ivanartastra.github.io/Art-estate"
RATES = {"RUB": 92, "THB": 36.5}  # курс USD→валюта (синхронно с js/script.js)

# Статические контент-страницы для sitemap (privacy исключаем — noindex)
STATIC_URLS = [
    "/blog/",
    "/blog/kak-kupit-nedvizhimost-na-phukete/",
    "/blog/freehold-vs-leasehold/",
    "/blog/rayony-phuketa/",
]

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def slugify(text, uid):
    s = (text or 'obj').lower()
    s = ''.join(TRANSLIT.get(ch, ch) for ch in s)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    s = re.sub(r'-{2,}', '-', s)[:60].strip('-')
    return f"{s}-u{uid}" if uid else s


def esc(s):
    return (str(s) if s is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def nsep(n):
    return f"{int(round(n)):,}".replace(",", " ")


def money_usd(u):
    return "$" + nsep(u) if u else "Цена по запросу"


def plural(n, one, few, many):
    n = abs(int(n)) % 100
    d = n % 10
    if 10 < n < 20:
        return many
    if 1 < d < 5:
        return few
    if d == 1:
        return one
    return many


PAGE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>__TITLE__ — купить на Пхукете | Art Estate</title>
<meta name="description" content="__METADESC__" />
<meta name="theme-color" content="#0f3f3a" />
<link rel="canonical" href="__CANON__" />
<link rel="icon" type="image/svg+xml" href="../../assets/favicon.svg" />
<meta property="og:type" content="product" />
<meta property="og:locale" content="ru_RU" />
<meta property="og:site_name" content="Art Estate" />
<meta property="og:title" content="__TITLE__ — Art Estate" />
<meta property="og:description" content="__METADESC__" />
<meta property="og:url" content="__CANON__" />
<meta property="og:image" content="__OGIMG__" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="__OGIMG__" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<link rel="stylesheet" href="../../css/styles.css" />
<style>
  body { background: var(--sand); }
  .pp-header { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 1rem clamp(1.2rem,4vw,3rem); background: rgba(246,241,231,.9); backdrop-filter: blur(14px); border-bottom: 1px solid rgba(20,32,31,.08); }
  .pp-wrap { max-width: 1080px; margin: 0 auto; padding: clamp(1.4rem,4vw,2.6rem); }
  .crumbs { font-size: .85rem; color: var(--ink-soft); margin: .4rem 0 1.4rem; }
  .crumbs a { color: var(--ink-soft); } .crumbs a:hover { color: var(--gold); }
  .crumbs span { color: var(--gold); }
  .pp-hero { display: grid; grid-template-columns: 1.15fr .85fr; gap: 1.8rem; align-items: stretch; }
  .pp-media { position: relative; border-radius: var(--radius); overflow: hidden; min-height: 320px; box-shadow: var(--shadow); }
  .pp-media img { width: 100%; height: 100%; object-fit: cover; }
  .pp-badges { position: absolute; top: 1rem; left: 1rem; display: flex; flex-direction: column; gap: .4rem; }
  .pp-info { display: flex; flex-direction: column; }
  .pp-type { color: var(--gold); font-weight: 700; text-transform: uppercase; letter-spacing: .12em; font-size: .78rem; }
  .pp-title { font-size: clamp(1.8rem,4vw,2.8rem); color: var(--teal); margin: .3rem 0 .5rem; }
  .pp-loc { color: var(--ink-soft); margin-bottom: 1.2rem; }
  .pp-price { font-family: 'Cormorant Garamond', serif; font-size: 2.6rem; font-weight: 700; color: var(--ink); line-height: 1.05; }
  .pp-price s { font-size: 1.2rem; color: var(--ink-soft); opacity: .7; margin-right: .6rem; font-family: 'Manrope', sans-serif; }
  .pp-price-sub { color: var(--ink-soft); font-size: .92rem; margin: .3rem 0 1.4rem; font-variant-numeric: tabular-nums; }
  .pp-actions { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: auto; }
  .pp-section { margin-top: 2.6rem; }
  .pp-section h2 { font-size: clamp(1.5rem,3vw,2rem); color: var(--teal); margin-bottom: 1rem; }
  .pp-desc { color: var(--ink-soft); font-size: 1.05rem; line-height: 1.7; }
  .pp-map { height: 360px; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); z-index: 0; }
  .pp-back { display: inline-flex; align-items: center; gap: .4rem; color: var(--teal); font-weight: 700; margin-top: 2.6rem; }
  @media (max-width: 820px) { .pp-hero { grid-template-columns: 1fr; } }
</style>
<script type="application/ld+json">__JSONLD__</script>
</head>
<body>
<header class="pp-header">
  <a href="../../" class="logo" style="color:var(--teal)">ART <span style="color:var(--gold)">ESTATE</span></a>
  <a href="tel:+79124869508" class="header__cta" style="color:var(--teal);border-color:rgba(15,63,58,.3)">+7 912 486-95-08</a>
</header>

<div class="pp-wrap">
  <nav class="crumbs" aria-label="Хлебные крошки">
    <a href="../../">Главная</a> / <a href="../../#catalog">Каталог</a> / <span>__TITLE__</span>
  </nav>

  <div class="pp-hero">
    <div class="pp-media">
      <img src="__IMG__" alt="__TITLE__ — фото" />
      <div class="pp-badges">__BADGES__</div>
    </div>
    <div class="pp-info">
      <span class="pp-type">__TYPE__</span>
      <h1 class="pp-title">__TITLE__</h1>
      <p class="pp-loc">__LOC__</p>
      <div class="pp-price">__OLD____PRICE__</div>
      <p class="pp-price-sub">__PRICE_SUB__</p>
      <div class="detail__specs" style="margin-bottom:1.4rem">__SPECS__</div>
      <div class="pp-actions">
        <a class="btn btn--wa" href="__WA__" target="_blank" rel="noopener">Узнать об объекте · WhatsApp</a>
        <a class="btn btn--tg" href="https://t.me/+79124869508" target="_blank" rel="noopener">Telegram</a>
      </div>
    </div>
  </div>

  __DESC_BLOCK__

  <div class="pp-section">
    <h2>Калькуляторы покупки</h2>
    <div class="calc-grid">
      <div class="calc">
        <h4>Кредитный калькулятор</h4>
        <label class="calc__row">Стоимость, $<input type="number" id="m_price" value="__PRICE_USD__" min="0" step="1000"></label>
        <label class="calc__row">Первоначальный взнос: <output id="m_down_v">30%</output><input type="range" id="m_down" min="0" max="90" value="30" step="5"></label>
        <label class="calc__row">Ставка, % годовых<input type="number" id="m_rate" value="6" min="0" max="30" step="0.1"></label>
        <label class="calc__row">Срок: <output id="m_term_v">20 лет</output><input type="range" id="m_term" min="5" max="30" value="20" step="1"></label>
        <div class="calc__out">
          <div><span>Платёж / мес</span><b id="m_payment">—</b></div>
          <div><span>Сумма кредита</span><b id="m_loan">—</b></div>
          <div><span>Переплата</span><b id="m_interest">—</b></div>
        </div>
        <p class="calc__note">Ориентировочный аннуитетный расчёт. Условия зависят от банка и статуса покупателя.</p>
      </div>
      <div class="calc">
        <h4>Калькулятор доходности</h4>
        <label class="calc__row">Стоимость, $<input type="number" id="r_price" value="__PRICE_USD__" min="0" step="1000"></label>
        <label class="calc__row">Аренда / мес, $<input type="number" id="r_rent" value="__RENT__" min="0" step="50"></label>
        <label class="calc__row">Загрузка: <output id="r_occ_v">75%</output><input type="range" id="r_occ" min="30" max="100" value="75" step="5"></label>
        <div class="calc__out">
          <div><span>Доход / год</span><b id="r_annual">—</b></div>
          <div><span>Доходность</span><b id="r_yield">—</b></div>
          <div><span>Окупаемость</span><b id="r_payback">—</b></div>
        </div>
        <p class="calc__note">__RENT_NOTE__ Без учёта налогов и комиссий УК.</p>
      </div>
    </div>
  </div>

  __MAP_BLOCK__

  <a class="pp-back" href="../../#catalog">← Все объекты каталога</a>
</div>

<footer class="footer" style="margin-top:3rem">
  <div class="footer__bottom" style="border:0">
    <span>© __YEAR__ Art Estate · Недвижимость на Пхукете</span>
    <a href="tel:+79124869508">+7 912 486-95-08</a>
  </div>
</footer>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function(){
  var $=function(id){return document.getElementById(id);};
  function nsep(n){return Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ');}
  function usd(n){return (n||n===0)?'$'+nsep(n):'—';}
  function plural(n,a,b,c){n=Math.abs(n)%100;var d=n%10;if(n>10&&n<20)return c;if(d>1&&d<5)return b;if(d===1)return a;return c;}
  var mp=$('m_price'),md=$('m_down'),mr=$('m_rate'),mt=$('m_term');
  function recalcM(){var p=+mp.value||0,dp=+md.value,rt=+mr.value,yr=+mt.value;$('m_down_v').textContent=dp+'%';$('m_term_v').textContent=yr+' '+plural(yr,'год','года','лет');var loan=p*(1-dp/100),i=rt/100/12,n=yr*12,pay=i>0?loan*i/(1-Math.pow(1+i,-n)):(n?loan/n:0);$('m_loan').textContent=usd(loan);$('m_payment').textContent=usd(pay);$('m_interest').textContent=usd(pay*n-loan);}
  [mp,md,mr,mt].forEach(function(e){e&&e.addEventListener('input',recalcM);});
  var rp=$('r_price'),rr=$('r_rent'),ro=$('r_occ');
  function recalcR(){var p=+rp.value||0,rent=+rr.value||0,occ=+ro.value/100;$('r_occ_v').textContent=(+ro.value)+'%';var an=rent*12*occ;$('r_annual').textContent=usd(an);$('r_yield').textContent=p?(an/p*100).toFixed(1)+'%':'—';$('r_payback').textContent=an?(p/an).toFixed(1)+' '+plural(Math.round(p/an),'год','года','лет'):'—';}
  [rp,rr,ro].forEach(function(e){e&&e.addEventListener('input',recalcR);});
  mp&&mp.addEventListener('input',function(){if(rp){rp.value=mp.value;recalcR();}});
  rp&&rp.addEventListener('input',function(){if(mp){mp.value=rp.value;recalcM();}});
  recalcM();recalcR();
  var ll=__LATLNG__;
  if(ll&&window.L){var el=$('ppMap');if(el){var m=L.map(el,{scrollWheelZoom:false}).setView(ll,14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(m);L.marker(ll).addTo(m).bindPopup(__TITLEJS__).openPopup();setTimeout(function(){m.invalidateSize();},200);}}
})();
</script>
</body>
</html>
"""


def build():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    catalog_path = os.path.join(root, "data", "catalog.json")
    data = json.load(open(catalog_path, encoding="utf-8"))
    items = data.get("items", [])
    year = dt.date.today().year
    urls = [SITE + "/"]

    for it in items:
        uid = it.get("id")
        slug = slugify(it.get("title"), uid)
        rel = f"object/{slug}/"
        it["slug"] = slug
        it["url"] = rel
        canon = f"{SITE}/{rel}"

        usd_v = it.get("priceUSD") or 0
        rent = it.get("rentMonthUSD") or (round(usd_v * 0.06 / 12) if usd_v else 0)
        img_rel = (it.get("image") or "assets/hero-phuket.jpg")
        og_img = f"{SITE}/{img_rel}"
        img_src = "../../" + img_rel

        # подцены в ₽ и ฿
        sub = []
        if usd_v:
            sub.append("≈ " + nsep(usd_v * RATES["RUB"]) + " ₽")
            sub.append(nsep(usd_v * RATES["THB"]) + " ฿")
        price_sub = " · ".join(sub)

        old = f"<s>{money_usd(it['oldPriceUSD'])}</s> " if it.get("oldPriceUSD") else ""

        badges = []
        if usd_v and rent:
            badges.append(f'<span class="badge badge--yield">{round(rent*12/usd_v*100)}% доходность</span>')
        if it.get("discountPct"):
            badges.append(f'<span class="badge badge--disc">−{it["discountPct"]}%</span>')
        badges_html = "".join(badges)

        specs = []
        if it.get("type"):
            specs.append(f'<div class="spec"><span>Тип</span><b>{esc(it["type"])}</b></div>')
        beds = it.get("beds")
        if isinstance(beds, (int, float)) and beds > 0:
            specs.append(f'<div class="spec"><span>Спальни</span><b>{int(beds)} {plural(beds,"спальня","спальни","спален")}</b></div>')
        elif beds:
            specs.append(f'<div class="spec"><span>Спальни</span><b>{esc(beds)}</b></div>')
        if it.get("baths") is not None:
            specs.append(f'<div class="spec"><span>Санузлы</span><b>{esc(it["baths"])}</b></div>')
        if it.get("area"):
            specs.append(f'<div class="spec"><span>Площадь</span><b>{esc(it["area"])} м²</b></div>')
        if it.get("pricePerM2"):
            specs.append(f'<div class="spec"><span>Цена за м²</span><b>${nsep(it["pricePerM2"])}</b></div>')
        if it.get("beach"):
            specs.append(f'<div class="spec"><span>У пляжа</span><b>{esc(it["beach"])}</b></div>')
        specs_html = "".join(specs)

        loc = esc(it.get("location") or "Пхукет, Таиланд")
        desc_text = it.get("description") or f'{it.get("title","Объект")} — {it.get("type","недвижимость")} на Пхукете. Свяжитесь с нами для подробностей, просмотра и условий покупки.'
        desc_block = f'<div class="pp-section"><h2>Описание</h2><p class="pp-desc">{esc(desc_text)}</p></div>'
        meta_desc = esc((desc_text[:155] + "…") if len(desc_text) > 158 else desc_text)

        wa = "https://wa.me/79124869508?text=" + _urlenc("Здравствуйте! Интересует объект «" + (it.get("title") or "") + "» с сайта Art Estate.")

        lat, lng = it.get("lat"), it.get("lng")
        if lat and lng:
            map_block = '<div class="pp-section"><h2>Расположение на карте</h2><div class="pp-map" id="ppMap"></div></div>'
            latlng = f"[{lat},{lng}]"
        else:
            map_block = ""
            latlng = "null"

        rent_note = "Аренда взята с объявления." if it.get("rentMonthUSD") else "Аренда оценочная (≈6% годовых)."

        jsonld = json.dumps({
            "@context": "https://schema.org",
            "@type": "Product",
            "name": it.get("title"),
            "image": [og_img],
            "description": desc_text,
            "category": it.get("type"),
            "offers": {"@type": "Offer", "priceCurrency": "USD", "price": usd_v,
                       "availability": "https://schema.org/InStock", "url": canon},
        }, ensure_ascii=False)
        breadcrumb = json.dumps({
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Главная", "item": SITE + "/"},
                {"@type": "ListItem", "position": 2, "name": "Каталог", "item": SITE + "/#catalog"},
                {"@type": "ListItem", "position": 3, "name": it.get("title"), "item": canon},
            ],
        }, ensure_ascii=False)
        jsonld_full = f"{jsonld}</script>\n<script type=\"application/ld+json\">{breadcrumb}"

        html = PAGE
        repl = {
            "__TITLE__": esc(it.get("title") or "Объект на Пхукете"),
            "__METADESC__": meta_desc,
            "__CANON__": canon,
            "__OGIMG__": og_img,
            "__IMG__": esc(img_src),
            "__TYPE__": esc(it.get("type") or "Объект"),
            "__LOC__": loc,
            "__OLD__": old,
            "__PRICE__": money_usd(usd_v),
            "__PRICE_SUB__": price_sub,
            "__BADGES__": badges_html,
            "__SPECS__": specs_html,
            "__DESC_BLOCK__": desc_block,
            "__WA__": esc(wa),
            "__PRICE_USD__": str(usd_v or 200000),
            "__RENT__": str(rent or 0),
            "__RENT_NOTE__": rent_note,
            "__MAP_BLOCK__": map_block,
            "__LATLNG__": latlng,
            "__TITLEJS__": json.dumps(it.get("title") or "Объект", ensure_ascii=False),
            "__JSONLD__": jsonld_full,
            "__YEAR__": str(year),
        }
        for k, v in repl.items():
            html = html.replace(k, v)

        out_dir = os.path.join(root, "object", slug)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
            f.write(html)
        urls.append(canon)
        print(f"  ✓ {rel}")

    # обновляем catalog.json (со slug/url)
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # sitemap.xml (объекты + статические контент-страницы)
    for s in STATIC_URLS:
        urls.append(SITE + s)
    today = dt.date.today().isoformat()
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        sm.append(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>")
    sm.append("</urlset>")
    with open(os.path.join(root, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(sm))

    print(f"\n✓ Сгенерировано страниц: {len(items)}")
    print(f"✓ sitemap.xml: {len(urls)} URL")
    print(f"✓ catalog.json обновлён (добавлены slug/url)")


def _urlenc(s):
    from urllib.parse import quote
    return quote(s, safe="")


if __name__ == "__main__":
    build()
