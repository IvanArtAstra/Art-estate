#!/usr/bin/env python3
"""Ставит первые письма вьетнамским партнёрам в очередь бота на одобрение.

    python3 tools/outreach/queue_vn.py --limit 10            # 10 следующих, аренда и продажа
    python3 tools/outreach/queue_vn.py --kind rent --limit 5 # только аренда
    python3 tools/outreach/queue_vn.py --dry-run             # показать, кому и что, ничего не ставить

Что происходит дальше — уже в боте (bot/partners.js):
  1. в Telegram обоим админам приходит «N писем ждут одобрения»;
  2. письма смотрят по одному или одобряют пачкой;
  3. cron раз в полчаса отправляет одобренные по одному, в рабочие часы
     Вьетнама и не больше OUTREACH_DAILY в день.

Сам скрипт ничего не отправляет. Адресаты — data/partners-vn.json, шаблоны —
data/outreach/vn-rent.txt и vn-sale.txt; всё это вне репозитория.
Кому уже поставили — помнит data/outreach/vn-state.json, а тех, кто уже есть
в воронке бота (написали нам сами), пропускает.
"""
import argparse
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
PARTNERS = os.path.join(ROOT, "data", "partners-vn.json")
STATE = os.path.join(ROOT, "data", "outreach", "vn-state.json")
TEMPLATES = {k: os.path.join(ROOT, "data", "outreach", f"vn-{k}.txt") for k in ("rent", "sale")}
BOT = os.path.join(ROOT, "bot")
TTL = 60 * 60 * 24 * 120
CITY_VI = {"da nang": "Đà Nẵng", "nha trang": "Nha Trang"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def load_template(kind):
    raw = open(TEMPLATES[kind], encoding="utf-8").read()
    subject = re.search(r"^SUBJECT:\s*(.+)$", raw, re.M).group(1).strip()
    parts = dict(re.findall(r"---(VI|EN|RU)---\n(.*?)(?=\n---(?:VI|EN|RU)---|\Z)", raw, re.S))
    return subject, parts["VI"].strip(), parts["EN"].strip(), parts["RU"].strip()


def city_vi(city):
    names = [CITY_VI.get(c.strip().lower(), c.strip()) for c in str(city or "").split(",") if c.strip()]
    return " và ".join(names) or "Đà Nẵng"


def letter(p):
    # агентства «аренда и продажа» получают письмо про аренду: в нём есть и вопрос про покупателей
    kind = "sale" if p.get("kind") == "sale" else "rent"
    subject, vi, en, ru = load_template(kind)
    fill = {"name": p["name"].strip(), "city_vi": city_vi(p.get("city"))}
    sub = lambda s: s.format(**fill)
    text = f"{sub(vi)}\n\n— English version below —\n\n{sub(en)}"
    return sub(subject), text, sub(ru), kind


def wrangler(*args, input_file=None):
    cmd = ["wrangler", *args, "--binding", "CHAT", "--remote"]
    if input_file:
        cmd.insert(4, input_file)
    r = subprocess.run(cmd, cwd=BOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"wrangler {' '.join(args)}: {r.stderr.strip()[-600:]}")
    return r.stdout


def known_in_bot():
    out = wrangler("kv", "key", "list", "--prefix", "pt:")
    try:
        start = out.index("[")
        return {k["name"][3:] for k in json.loads(out[start:])}
    except ValueError:
        return set()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--kind", choices=["rent", "sale", "all"], default="all")
    ap.add_argument("--city", help="Da Nang или Nha Trang")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    partners = json.load(open(PARTNERS, encoding="utf-8"))["partners"]
    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {"queued": {}}
    skip = set(state["queued"]) | (set() if a.dry_run else known_in_bot())

    picked = []
    for p in partners:
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
    bulk = []
    for i, (email, p) in enumerate(picked):
        subject, text, ru, kind = letter(p)
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
            "city": p.get("city"), "website": p.get("website"), "source": p.get("sourceUrl"),
            "phone": p.get("phone"), "zalo": p.get("zalo"), "createdAt": iso, "history": [],
        }
        bulk += [
            {"key": f"ob:{oid}", "value": json.dumps(rec, ensure_ascii=False), "expiration_ttl": TTL},
            {"key": f"obp:{created}:{oid}", "value": oid, "expiration_ttl": TTL},
            {"key": f"pt:{email}", "value": json.dumps(partner, ensure_ascii=False),
             "metadata": {"s": "queued", "n": p["name"][:60], "lo": "", "li": "", "r": 0, "o": 0}},
        ]
        print(f"{'[dry] ' if a.dry_run else ''}{kind:4} {p.get('city', ''):12} {p['name']} <{email}>")

    if a.dry_run:
        print("\nПример письма:\n\n" + letter(picked[0][1])[1])
        return

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(bulk, f, ensure_ascii=False)
        path = f.name
    try:
        wrangler("kv", "bulk", "put", input_file=path)
    finally:
        os.unlink(path)

    for email, p in picked:
        state["queued"][email] = {"name": p["name"], "at": iso}
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nВ очереди на одобрение: {len(picked)}. В течение получаса бот пришлёт уведомление в Telegram.")


if __name__ == "__main__":
    main()
