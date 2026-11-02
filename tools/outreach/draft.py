#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Черновики писем застройщикам и агентствам.

Собирает по каждой цели из data/developers.json индивидуальное письмо и
кладёт его в data/outreach/. Ничего не отправляет: отправляет человек.

Так сделано не из перестраховки. В Турции отправитель коммерческих
электронных сообщений обязан зарегистрироваться в государственной системе
İYS и сверяться с отказами — включая отправителей из-за рубежа. Плюс домен
estateart.homes новый: объём рассылки с него уводит в спам и сам домен, и
письма будущим клиентам. Десяток писем в день, отправленных вручную, обе
проблемы обходит, а для партнёрского письма работает лучше рассылки.

    python3 tools/outreach/draft.py                 # черновики для всех «не связывались»
    python3 tools/outreach/draft.py --only "Yekta"  # по одной цели
    python3 tools/outreach/draft.py --lang ru       # язык письма (по умолчанию en)
    python3 tools/outreach/draft.py --telegram      # прислать карточки в Telegram

Ключ Anthropic и токен бота берутся из bot/.secrets.env.
"""
import argparse
import io
import json
import os
import re
import sys
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGETS = os.path.join(ROOT, "data", "developers.json")
OUTDIR = os.path.join(ROOT, "data", "outreach")
SECRETS = os.path.join(ROOT, "bot", ".secrets.env")

MODEL = "claude-sonnet-5-5"   # письмо пишется один раз и читается человеком — берём сильную
SITE = "https://estateart.homes"
PARTNERS_RU = SITE + "/partners/"
PARTNERS_EN = SITE + "/partners/en/"

SYSTEM = """Ты пишешь письмо от имени агентства недвижимости Estate Art.

КТО МЫ
Estate Art подбирает и сопровождает покупку жилья за рубежом для русскоязычных
покупателей. Сейчас Таиланд (Пхукет) и Вьетнам (Дананг, Нячанг), открываем
Турцию. Агент — Артемьева Алена Николаевна. Сайт estateart.homes.

ЗАЧЕМ ПИШЕМ
Хотим размещать объекты адресата у себя и приводить ему покупателя за комиссию
по факту сделки. Ничего не просим вперёд.

КАК ПИСАТЬ
Коротко: 120–160 слов, не больше. Это первое письмо незнакомому человеку,
который получает десять таких в неделю, и длинное он не дочитает.

Первая фраза — про НИХ, не про нас: назови их конкретный проект или район и
скажи что-то верное по делу. Это единственное, что отличает письмо от рассылки.

Дальше: кто мы в одном предложении, что предлагаем в одном, что нужно от них
в одном. Заканчивай одним конкретным вопросом, на который легко ответить
«да» или «нет».

ЧЕГО НЕ ДЕЛАТЬ
Не хвалить без повода и не писать «ваша прекрасная компания». Не обещать
объёмов и сроков, которых мы не знаем. Не придумывать проекты, цифры и факты
про адресата — используй только то, что дано во вводных. Не называть размер
комиссии: его обсуждают, а не объявляют в первом письме. Никаких
восклицательных знаков. Не представляться крупной компанией: мы молодые,
и если это всплывёт, скажи сам и раньше них.

ПОДПИСЬ
Строго такая, без должностей, адресов и слоганов:

Alena Artemyeva, Estate Art
estateart.homes

Ничего после подписи не добавляй — ни «с уважением», ни телефонов, ни
юридических блоков. Ссылка на сайт и есть подпись.

ОТВЕТ
Верни строго JSON: {"subject": "...", "body": "..."}. В body — текст письма
с переводами строк, уже с подписью. Без markdown и без обратных кавычек."""


def secrets():
    out = {}
    if not os.path.exists(SECRETS):
        sys.exit("Нет bot/.secrets.env — там лежит ключ Anthropic")
    for line in io.open(SECRETS, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def claude(key, system, prompt, tries=4):
    """Повторы обязательны: соединение до api.anthropic.com рвётся на ровном
    месте, и без них прогон падает на первой же сетевой икоте, потеряв
    остальные письма."""
    last = None
    for attempt in range(tries):
        try:
            return _claude_once(key, system, prompt)
        except (urllib.error.HTTPError,) as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < tries - 1:
                last = e
                time.sleep(2 ** attempt)
                continue
            raise
        except Exception as e:
            last = e
            if attempt < tries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise last


def _claude_once(key, system, prompt):
    """Запрос идёт через curl, а не через urllib.

    Системный Python на этой машине рвёт TLS-рукопожатие к api.anthropic.com
    («handshake operation timed out», «EOF in violation of protocol»), тогда
    как curl к тому же адресу соединяется за 30 мс. Чинить чужой SSL-стек
    ради одного скрипта смысла нет — берём инструмент, который работает.

    Тело передаём файлом, а ключ — через заголовок из stdin-файла: так ни
    ключ, ни письмо не попадают в список процессов."""
    body = json.dumps({
        "model": MODEL, "max_tokens": 4000, "system": system,
        "messages": [{"role": "user", "content": prompt}],
    })
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        f.write(body)
        body_path = f.name
    with tempfile.NamedTemporaryFile("w", suffix=".hdr", delete=False, encoding="utf-8") as f:
        f.write("content-type: application/json\n")
        f.write("x-api-key: %s\n" % key)
        f.write("anthropic-version: 2023-06-01\n")
        hdr_path = f.name
    try:
        p = subprocess.run(
            ["curl", "-sS", "--max-time", "120", "-X", "POST",
             "https://api.anthropic.com/v1/messages",
             "-H", "@" + hdr_path, "--data-binary", "@" + body_path],
            capture_output=True, text=True)
    finally:
        for path in (body_path, hdr_path):
            try: os.unlink(path)
            except OSError: pass
    if p.returncode != 0:
        raise RuntimeError("curl: " + (p.stderr or "код %d" % p.returncode).strip())
    try:
        data = json.loads(p.stdout)
    except ValueError:
        raise RuntimeError("не разобрал ответ: " + p.stdout[:200])
    if data.get("type") == "error":
        raise RuntimeError("anthropic: " + json.dumps(data.get("error", {}), ensure_ascii=False))
    text = "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
    if not text and data.get("stop_reason") == "max_tokens":
        raise RuntimeError("не хватило max_tokens: модель не дошла до ответа")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError("модель вернула не JSON: " + (text[:200] or "(пусто)"))
    return json.loads(m.group(0))


def brief(t, lang):
    """Вводные по цели. Только проверенные поля — выдуманного в письме быть не должно."""
    lines = ["Адресат: %s (%s)" % (t["name"], t.get("kind", "компания"))]
    if t.get("city"):
        lines.append("Где: %s, %s" % (t["city"], t.get("country", "")))
    # Сначала то, что проверено разведкой, потом общий список из первой версии:
    # проверенное конкретнее и даёт первую фразу, ради которой письмо читают
    if t.get("projects_current"):
        lines.append("Что строят сейчас (проверено на их сайте):")
        for p in t["projects_current"]:
            lines.append("  — " + p)
    elif t.get("projects"):
        lines.append("Их проекты: " + ", ".join(t["projects"]))
    if t.get("partner_page"):
        lines.append("Партнёрская страница у них: " + t["partner_page"])
    if t.get("foreign_focus"):
        lines.append("Как работают с иностранцами: " + t["foreign_focus"])
    if t.get("contact_ru"):
        lines.append("Русскоязычный контакт на их стороне: " + t["contact_ru"])
    if t.get("extras"):
        lines.append("Чем выделяются: " + t["extras"])
    if t.get("has_1plus1"):
        lines.append("У них есть планировки 1+1 — наш покупатель спрашивает именно их.")
    if t.get("prices_public") is False:
        lines.append("Цен в открытом доступе нет — прайс закрытый.")
    if t.get("price_range"):
        lines.append("Цены у них открыты: " + t["price_range"])
    if t.get("hook"):
        lines.append("ЗАХОД, с которого начинать письмо: " + t["hook"])
    if t.get("approach"):
        lines.append("ВАЖНО, как писать: " + t["approach"])
    if t.get("competitor"):
        lines.append("Это не только поставщик, но и конкурент — учти в тоне.")
    if t.get("partner_program"):
        lines.append("У них УЖЕ есть партнёрская программа — сошлись на неё, "
                     "это повод написать и половина разговора позади.")
    if t.get("terms_known"):
        lines.append("Что известно про их условия: " + t["terms_known"])
    if t.get("warnings"):
        lines.append("НЕ УПОМИНАТЬ (разведка не подтвердила): " + t["warnings"])
    if t.get("note"):
        lines.append("Заметка: " + t["note"])
    lines.append("Язык письма: " + ("русский" if lang == "ru" else "английский"))
    lines.append("Ссылка на нашу страницу для партнёров: " +
                 (PARTNERS_RU if lang == "ru" else PARTNERS_EN))
    lines.append("Эту ссылку вставь в текст письма один раз, там где предлагаешь "
                 "посмотреть условия. В подписи — только estateart.homes.")
    return "\n".join(lines)


def tg(token, chat, text):
    body = json.dumps({"chat_id": chat, "text": text, "parse_mode": "HTML",
                       "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(
        "https://api.telegram.org/bot%s/sendMessage" % token, data=body,
        method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    ap = argparse.ArgumentParser(description="Черновики партнёрских писем")
    ap.add_argument("--only", help="подстрока имени цели")
    ap.add_argument("--lang", default="en", choices=["en", "ru"])
    ap.add_argument("--limit", type=int, default=5, help="сколько черновиков за прогон")
    ap.add_argument("--telegram", action="store_true", help="прислать карточки в Telegram")
    args = ap.parse_args()

    env = secrets()
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("В bot/.secrets.env пустой ANTHROPIC_API_KEY")

    data = json.loads(io.open(TARGETS, encoding="utf-8").read())
    targets = data["targets"]
    if args.only:
        targets = [t for t in targets if args.only.lower() in t["name"].lower()]
    else:
        targets = [t for t in targets if t.get("status") == "не связывались"]
    targets = targets[:args.limit]

    if not targets:
        print("Нечего писать: подходящих целей не нашлось.")
        return

    os.makedirs(OUTDIR, exist_ok=True)
    print("Черновиков к написанию: %d\n" % len(targets))

    for t in targets:
        print("— %s" % t["name"])
        try:
            letter = claude(key, SYSTEM, brief(t, args.lang))
        except Exception as e:
            print("   ✗ не вышло: %s" % e)
            continue

        slug = re.sub(r"[^a-z0-9]+", "-", t["name"].lower()).strip("-")
        path = os.path.join(OUTDIR, "%s.%s.txt" % (slug, args.lang))
        io.open(path, "w", encoding="utf-8").write(
            "Кому: %s\nТема: %s\n\n%s\n" % (t["name"], letter["subject"], letter["body"]))
        print("   ✓ %s" % os.path.relpath(path, ROOT))
        print("     Тема: %s" % letter["subject"])

        if args.telegram:
            token, chat = env.get("BOT_TOKEN"), env.get("AGENT_CHAT_ID", "").split(",")[0]
            if token and chat:
                tg(token, chat,
                   "📄 <b>Черновик письма</b>\n<b>%s</b>\n\n<b>Тема:</b> %s\n\n<pre>%s</pre>\n\n"
                   "<i>Прочитайте, поправьте и отправьте сами. Автоматической отправки нет.</i>"
                   % (esc(t["name"]), esc(letter["subject"]), esc(letter["body"])))
                print("     → карточка в Telegram")

    print("""
Дальше вручную:
  1. Прочитать черновик. Если в нём есть факт про адресата, которого вы не
     знаете наверняка, — убрать. Выдуманная деталь в первом письме стоит
     дороже, чем её отсутствие.
  2. Отправить со своего ящика на домене, по одному.
  3. Поставить статус в data/developers.json: «написали, дата».""")


if __name__ == "__main__":
    main()
