#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Перевод сайта на собственный домен.

Меняет адрес во всех canonical, OpenGraph, structured data, sitemap, llms.txt,
robots.txt и в шаблонах генератора страниц, плюс кладёт файл CNAME, по которому
GitHub Pages понимает, какой домен обслуживать.

    python3 tools/switch_domain.py estateart.homes
    python3 tools/switch_domain.py estateart.homes --dry-run

Порядок важен: сначала DNS у регистратора, потом этот скрипт. Если положить
CNAME раньше, чем заработают записи, GitHub Pages начнёт отдавать сайт только
по новому домену, а тот ещё не резолвится — и сайт станет недоступен.
"""
import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = "https://estateart.homes"
EXT = {".html", ".py", ".txt", ".toml", ".xml", ".json", ".md", ".js"}
SKIP_DIRS = {".git", "node_modules", ".playwright-mcp", "assets"}


def files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if os.path.splitext(name)[1].lower() in EXT:
                yield os.path.join(dirpath, name)


def main():
    ap = argparse.ArgumentParser(description="Перевести сайт на свой домен")
    ap.add_argument("domain", help="например estateart.homes")
    ap.add_argument("--dry-run", action="store_true", help="показать, что изменится, но не менять")
    ap.add_argument("--old", default=OLD, help="текущий адрес, если отличается")
    args = ap.parse_args()

    domain = args.domain.strip().lower().lstrip(".").replace("https://", "").replace("http://", "").rstrip("/")
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", domain):
        sys.exit(f"Домен «{domain}» не похож на домен.")
    new = f"https://{domain}"

    changed = []
    for path in files():
        try:
            with open(path, encoding="utf-8") as f:
                src = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        if args.old not in src:
            continue
        n = src.count(args.old)
        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(src.replace(args.old, new))
        changed.append((os.path.relpath(path, ROOT), n))

    total = sum(n for _, n in changed)
    print(f"{'Нашёл' if args.dry_run else 'Заменил'} {total} вхождений в {len(changed)} файлах")
    for rel, n in sorted(changed, key=lambda x: -x[1])[:12]:
        print(f"  {rel:52} ×{n}")
    if len(changed) > 12:
        print(f"  … и ещё {len(changed) - 12} файлов")

    # CNAME — по нему GitHub Pages понимает, какой домен обслуживать
    cname = os.path.join(ROOT, "CNAME")
    if args.dry_run:
        print(f"\nСоздал бы CNAME с содержимым: {domain}")
    else:
        with open(cname, "w", encoding="utf-8") as f:
            f.write(domain + "\n")
        print(f"\n✓ CNAME: {domain}")

    # Виджет чата обращается к воркеру — домен должен быть в списке разрешённых
    wt = os.path.join(ROOT, "bot", "wrangler.toml")
    if os.path.exists(wt):
        with open(wt, encoding="utf-8") as f:
            w = f.read()
        # Проверяем именно список origin, а не файл целиком: SITE_URL в этом же
        # файле заменяется общим проходом выше, и проверка по всему файлу
        # считала работу сделанной, когда ALLOWED_ORIGINS ещё старый.
        m = re.search(r'ALLOWED_ORIGINS = "([^"]*)"', w)
        origins = m.group(1).split(",") if m else []
        want = [new, f"https://www.{domain}"]
        missing = [o for o in want if o not in origins]
        if m and missing:
            w2 = w.replace(m.group(0),
                           'ALLOWED_ORIGINS = "' + ",".join(missing + origins) + '"', 1)
            if not args.dry_run:
                with open(wt, "w", encoding="utf-8") as f:
                    f.write(w2)
            print(f"{'Добавил бы' if args.dry_run else '✓ Добавил'} {', '.join(missing)} в ALLOWED_ORIGINS воркера")

    if args.dry_run:
        print("\nЭто был пробный прогон, ничего не изменено.")
        return

    print("\nПерегенерирую страницы и sitemap…")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scraper", "build_pages.py")],
                       cwd=ROOT, capture_output=True, text=True)
    print("  " + (r.stdout.strip().splitlines() or ["без вывода"])[-1])
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "seo_schema.py")],
                       cwd=ROOT, capture_output=True, text=True)
    print("  " + (r.stdout.strip().splitlines() or ["без вывода"])[-1])
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "price_ranges.py")],
                       cwd=ROOT, capture_output=True, text=True)
    print("  " + (r.stdout.strip().splitlines() or ["без вывода"])[-1])
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "stamp_assets.py")],
                       cwd=ROOT, capture_output=True, text=True)
    print("  " + (r.stdout.strip().splitlines() or ["без вывода"])[-1])

    print(f"""
Дальше вручную:
  1. Убедиться, что DNS уже отвечает:  dig +short {domain}
     Должны вернуться адреса GitHub Pages (185.199.108–111.153).
  2. Закоммитить и запушить — GitHub Pages подхватит CNAME сам.
  3. В настройках репозитория Pages включить Enforce HTTPS,
     когда выпустится сертификат (обычно 15 минут — час).
  4. Передеплоить воркер чата:  cd bot && wrangler deploy
""")


if __name__ == "__main__":
    main()
