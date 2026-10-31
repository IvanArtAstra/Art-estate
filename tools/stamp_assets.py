#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Отпечаток содержимого в адресах своих стилей и скриптов.

GitHub Pages отдаёт их с max-age=600. Это значит, что любая ошибка, уехавшая
в прод, живёт у уже заходивших посетителей ещё десять минут после исправления,
и сделать с этим на стороне сервера нечего. Сегодня так и вышло: правка,
возвращавшая кнопки связи, доехала до сервера сразу, а до браузеров — нет.

Скрипт дописывает к каждому своему css/js короткий хэш содержимого:

    css/styles.css  →  css/styles.css?v=a1b2c3d4

Адрес меняется вместе с файлом, поэтому новая версия подхватывается сразу,
а неизменившиеся файлы остаются в кэше. Чужие адреса (CDN, telegram.org)
не трогаются.

    python3 tools/stamp_assets.py
    python3 tools/stamp_assets.py --check   # только сказать, что разошлось
"""
import argparse
import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["index.html"]
# href/src на свой файл: без схемы, без //, с нужным расширением
REF = re.compile(r'(?P<attr>href|src)="(?P<path>(?!https?:|//|data:)[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def stamp(page, check):
    full = os.path.join(ROOT, page)
    src = io.open(full, encoding="utf-8").read()
    missing, changed = [], []

    def sub(m):
        rel = m.group("path")
        target = os.path.join(os.path.dirname(full), rel)
        if not os.path.exists(target):
            missing.append(rel)
            return m.group(0)
        new = '%s="%s?v=%s"' % (m.group("attr"), rel, digest(target))
        if new != m.group(0):
            changed.append(rel)
        return new

    out = REF.sub(sub, src)
    if missing:
        print("  ! не нашёл файл, адрес оставлен как был: " + ", ".join(sorted(set(missing))))
    if not changed:
        print("  %s — отпечатки актуальны" % page)
        return False
    if check:
        print("  %s — разошлись: %s" % (page, ", ".join(sorted(set(changed)))))
        return True
    io.open(full, "w", encoding="utf-8").write(out)
    print("  %s — обновил: %s" % (page, ", ".join(sorted(set(changed)))))
    return True


def main():
    ap = argparse.ArgumentParser(description="Отпечатки содержимого в адресах стилей и скриптов")
    ap.add_argument("--check", action="store_true", help="не менять, только сообщить")
    args = ap.parse_args()

    print("Отпечатки своих стилей и скриптов:")
    dirty = any([stamp(p, args.check) for p in PAGES])
    if args.check and dirty:
        sys.exit(1)


if __name__ == "__main__":
    main()
