#!/usr/bin/env python3
"""Ставит первые письма партнёрам в очередь бота на одобрение.

    python3 tools/outreach/queue.py --limit 10                     # 10 следующих из всех баз
    python3 tools/outreach/queue.py --country th --kind sale --limit 5
    python3 tools/outreach/queue.py --dry-run --country id         # кому и что, ничего не ставить

Адресаты — data/partners-*.json (вьетнамские агентства, застройщики Вьетнама,
Пхукет, Бали). Письма — data/outreach/letters/<kind>.<язык>.txt. Всё это вне
репозитория: контакты адресатов и наши письма публиковать нельзя.

Язык письма:
  • у компании есть русский отдел (russian: true) — по-русски и по-английски;
  • lang: "en" — только по-английски;
  • иначе — на языке компании (vi, th, id) и ниже по-английски.

Что дальше — в боте (bot/partners.js): в Telegram приходит «N писем ждут
одобрения», их смотрят по одному или одобряют пачкой, а cron отправляет
одобренные по одному раз в полчаса в рабочие часы, в пределах дневного лимита.
Сам скрипт ничего не отправляет. Кому уже поставили — помнит
data/outreach/state.json; тех, кто уже есть в воронке бота, пропускает.
"""
import argparse
import glob
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LETTERS = os.path.join(ROOT, "data", "outreach", "letters")
STATE = os.path.join(ROOT, "data", "outreach", "state.json")
BOT = os.path.join(ROOT, "bot")
TTL = 60 * 60 * 24 * 120
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
LOCAL = {"vn": "vi", "th": "th", "id": "id"}

# Как называть место на языке письма: «tại Đà Nẵng», «ในภูเก็ต», «di Bali»
PLACES = {
    "vi": {"da nang": "Đà Nẵng", "nha trang": "Nha Trang", "hoi an": "Hội An", "cam ranh": "Cam Ranh",
           "phu quoc": "Phú Quốc", "ho chi minh": "TP. Hồ Chí Minh", "vung tau": "Vũng Tàu"},
    "th": {"phuket": "ภูเก็ต"},
    "id": {"bali": "Bali"},
}
DEFAULT_PLACE = {"vn": "Việt Nam", "th": "Phuket", "id": "Bali"}


def place(p, lang):
    city = re.sub(r"\(.*?\)", "", str(p.get("city") or "")).strip()
    if lang in PLACES:
        names = [v for k, v in PLACES[lang].items() if k in city.lower()]
        if names:
            return " và ".join(names) if lang == "vi" else names[0]
    return city or DEFAULT_PLACE.get(p.get("country"), "Southeast Asia")


def template(kind, lang):
    raw = open(os.path.join(LETTERS, f"{kind}.{lang}.txt"), encoding="utf-8").read()
    m = re.match(r"Subject:\s*(.+?)\n\n(.*)", raw, re.S)
    return m.group(1).strip(), m.group(2).strip()


def summary(kind):
    return open(os.path.join(LETTERS, f"{kind}.summary.txt"), encoding="utf-8").read().strip()


def letter_lang(p):
    if p.get("russian"):
        return "ru"
    lang = (p.get("lang") or LOCAL.get(p.get("country"), "en")).lower()
    return lang if os.path.exists(os.path.join(LETTERS, f"sale.{lang}.txt")) else "en"


def letter(p):
    kind = "sale" if p.get("kind") == "sale" else "rent"   # «аренда и продажа» — письмо про аренду, в нём есть вопрос про покупателей
    lang = letter_lang(p)
    fill = lambda s, l: s.replace("{name}", p["name"].strip()).replace("{place}", place(p, l))
    subj_en, body_en = template(kind, "en")
    if lang == "en":
        return fill(subj_en, "en"), fill(body_en, "en"), summary(kind), kind, lang
    subj, body = template(kind, lang)
    text = f"{fill(body, lang)}\n\n— English version below —\n\n{fill(body_en, 'en')}"
    return fill(subj, lang), text, summary(kind), kind, lang


def wrangler(*args, input_file=None):
    cmd = ["wrangler", *args]
    if input_file:
        cmd.append(input_file)
    cmd += ["--binding", "CHAT", "--remote"]
    r = subprocess.run(cmd, cwd=BOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"wrangler {' '.join(args)}: {r.stderr.strip()[-600:]}")
    return r.stdout


def bulk_put(items):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
        path = f.name
    try:
        wrangler("kv", "bulk", "put", input_file=path)
    finally:
        os.unlink(path)


def known_in_bot():
    out = wrangler("kv", "key", "list", "--prefix", "pt:")
    try:
        return {k["name"][3:] for k in json.loads(out[out.index("["):])}
    except ValueError:
        return set()


def reminders():
    """Напоминания на каждом языке — в KV, откуда их берёт бот (в коде их нет: репозиторий публичный)."""
    items = []
    tr = open(os.path.join(LETTERS, "reminder.summary.txt"), encoding="utf-8").read().strip()
    for path in glob.glob(os.path.join(LETTERS, "reminder.*.txt")):
        lang = path.split(".")[-2]
        if lang == "summary":
            continue
        text = open(path, encoding="utf-8").read().strip()
        items.append({"key": f"tpl:reminder:{lang}", "value": json.dumps({"text": text, "translation": tr}, ensure_ascii=False)})
    return items


def load_partners(country):
    out = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "partners-*.json"))):
        data = json.load(open(path, encoding="utf-8"))
        file_country = data.get("country") or ("vn" if "partners-vn" in path else None)
        for p in data.get("partners", []):
            p.setdefault("country", file_country or "vn")
            if not country or p["country"] == country:
                out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--country", choices=["vn", "th", "id"])
    ap.add_argument("--kind", choices=["rent", "sale", "all"], default="all")
    ap.add_argument("--city", help="подстрока города: Da Nang, Phuket, Canggu…")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {"queued": {}}
    skip = set(state["queued"]) | (set() if a.dry_run else known_in_bot())

    picked = []
    for p in load_partners(a.country):
        email = str(p.get("email") or "").strip().lower()
        if not EMAIL_RE.match(email) or email in skip:
            continue
        if a.kind != "all" and p.get("kind") not in (a.kind, "both"):
            continue
        if a.city and a.city.lower() not in str(p.get("city", "")).lower():
            continue
        picked.append((email, p))
        skip.add(email)
        if len(picked) >= a.limit:
            break

    if not picked:
        print("Некому писать: все адресаты с email уже в очереди или в воронке.")
        return

    now_ms = int(time.time() * 1000)
    iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    bulk = [] if a.dry_run else reminders()
    for i, (email, p) in enumerate(picked):
        subject, text, ru, kind, lang = letter(p)
        oid = secrets.token_hex(5)
        created = now_ms + i
        rec = {
            "id": oid, "to": email, "name": p["name"], "subject": subject, "text": text,
            "translation": ru, "kind": "first", "inReplyTo": "", "references": "",
            "status": "pending", "notBefore": 0,
            "createdAt": datetime.fromtimestamp(created / 1000, timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        partner = {
            "email": email, "name": p["name"], "stage": "queued", "kind": p.get("kind"),
            "country": p.get("country"), "lang": lang, "city": p.get("city"),
            "website": p.get("website"), "source": p.get("sourceUrl"),
            "phone": p.get("phone"), "createdAt": iso, "history": [],
        }
        bulk += [
            {"key": f"ob:{oid}", "value": json.dumps(rec, ensure_ascii=False), "expiration_ttl": TTL},
            {"key": f"obp:{created}:{oid}", "value": oid, "expiration_ttl": TTL},
            {"key": f"pt:{email}", "value": json.dumps(partner, ensure_ascii=False),
             "metadata": {"s": "queued", "n": p["name"][:60], "lo": "", "li": "", "r": 0, "o": 0}},
        ]
        print(f"{'[dry] ' if a.dry_run else ''}{p['country']} {lang:2} {kind:4} {str(p.get('city', ''))[:18]:18} {p['name']} <{email}>")

    if a.dry_run:
        print("\nПример письма:\n\nТема: " + letter(picked[0][1])[0] + "\n\n" + letter(picked[0][1])[1])
        return

    bulk_put(bulk)
    for email, p in picked:
        state["queued"][email] = {"name": p["name"], "country": p.get("country"), "at": iso}
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nВ очереди на одобрение: {len(picked)}. В течение получаса бот пришлёт уведомление в Telegram.")


if __name__ == "__main__":
    main()
