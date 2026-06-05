#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Art Estate — локальная админ-панель (оператор).
================================================

Запускается НА ВАШЕМ КОМПЬЮТЕРЕ (GitHub Pages — статика и не может это исполнять):

    python3 admin/server.py
    → откройте http://127.0.0.1:8787/admin/

Возможности:
  • вход по аккаунту (логин/пароль), сессии в cookie;
  • статистика по каталогу;
  • кнопка «Спарсить и обновить» — запускает scrape_fazwaz → enrich_gallery → build_pages;
  • редактирование объектов (цена, тип, описание, скрыть/удалить, порядок) → пишет data/catalog.json;
  • «Опубликовать» — git add/commit/push (публичный сайт обновится).

Аккаунт:
  • по умолчанию создаётся admin / (пароль печатается в консоль при первом запуске);
  • сменить:  python3 admin/server.py --set-user НОВЫЙ --set-pass ПАРОЛЬ
  • или задать через переменные окружения ADMIN_USER / ADMIN_PASS.

Безопасность: сервер слушает только 127.0.0.1 (локально). Файл admin/admin_config.json
с хэшем пароля НЕ коммитится (см. .gitignore).
"""

import hashlib
import http.server
import json
import os
import re
import secrets
import socketserver
import subprocess
import sys
import threading
import time
from http import cookies
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(HERE, "admin_config.json")
CATALOG = os.path.join(ROOT, "data", "catalog.json")
HOST, PORT = "127.0.0.1", int(os.environ.get("ADMIN_PORT", "8787"))
ITER = 200_000

SESSIONS = {}          # token -> created_ts
SESSION_TTL = 8 * 3600
JOB = {"running": False, "done": False, "ok": False, "log": [], "started": 0}


# ---------------- аккаунт / пароль ----------------
def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), ITER).hex()


def save_config(user, pw):
    salt = secrets.token_hex(16)
    json.dump({"user": user, "salt": salt, "hash": hash_pw(pw, salt), "iter": ITER},
              open(CONFIG, "w"))
    os.chmod(CONFIG, 0o600)


def load_config():
    if not os.path.exists(CONFIG):
        user = os.environ.get("ADMIN_USER", "admin")
        pw = os.environ.get("ADMIN_PASS") or secrets.token_urlsafe(9)
        save_config(user, pw)
        print("\n" + "=" * 56)
        print("  Создан аккаунт администратора Art Estate:")
        print(f"     логин:  {user}")
        print(f"     пароль: {pw}")
        print("  Смените: python3 admin/server.py --set-user X --set-pass Y")
        print("=" * 56 + "\n")
    return json.load(open(CONFIG))


def verify(user, pw):
    c = load_config()
    return user == c["user"] and hash_pw(pw, c["salt"]) == c["hash"]


# ---------------- статистика ----------------
def read_catalog():
    try:
        return json.load(open(CATALOG, encoding="utf-8"))
    except Exception:
        return {"items": []}


def compute_stats():
    d = read_catalog()
    items = d.get("items", [])
    prices = [it["priceUSD"] for it in items if it.get("priceUSD")]
    yields = [round(it["rentMonthUSD"] * 12 / it["priceUSD"] * 100, 1)
              for it in items if it.get("rentMonthUSD") and it.get("priceUSD")]
    by_type, by_district = {}, {}
    for it in items:
        t = it.get("type") or "—"
        by_type[t] = by_type.get(t, 0) + 1
        dloc = (it.get("location") or "").split(",")[0].strip() or "—"
        by_district[dloc] = by_district.get(dloc, 0) + 1
    disc = [it for it in items if it.get("discountPct")]
    return {
        "updated": d.get("updated"), "source": d.get("source"),
        "count": len(items),
        "hidden": sum(1 for it in items if it.get("hidden")),
        "withGallery": sum(1 for it in items if it.get("images")),
        "withGeo": sum(1 for it in items if it.get("lat")),
        "withDiscount": len(disc),
        "avgDiscount": round(sum(it["discountPct"] for it in disc) / len(disc), 1) if disc else 0,
        "priceMin": min(prices) if prices else 0,
        "priceMax": max(prices) if prices else 0,
        "priceAvg": round(sum(prices) / len(prices)) if prices else 0,
        "portfolio": sum(prices) if prices else 0,
        "avgYield": round(sum(yields) / len(yields), 1) if yields else 0,
        "byType": by_type, "byDistrict": by_district,
    }


# ---------------- запуск парсера (фоновый job) ----------------
def run_pipeline(pages, limit, gallery):
    JOB.update(running=True, done=False, ok=False, log=[], started=time.time())

    def log(line):
        JOB["log"].append(line)

    def run(cmd, title):
        log(f"▶ {title}")
        try:
            p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, bufsize=1)
            for ln in p.stdout:
                ln = ln.rstrip()
                if ln and "NotOpenSSL" not in ln and "warnings.warn" not in ln:
                    log(ln)
            p.wait()
            return p.returncode == 0
        except Exception as e:
            log(f"! ошибка: {e}")
            return False

    ok = run(["python3", "scraper/scrape_fazwaz.py", "--pages", str(pages),
              "--limit", str(limit), "--delay", "0.8"], "Парсинг объектов с fazwaz.ru")
    if ok and gallery:
        ok = run(["python3", "scraper/enrich_gallery.py", "--max", "6", "--delay", "0.6"],
                 "Скачивание галереи фото") or True  # галерея не критична
    if ok:
        ok = run(["python3", "scraper/build_pages.py"], "Генерация страниц и sitemap")
    log("✓ Готово. Нажмите «Опубликовать», чтобы обновить сайт." if ok else "✗ Завершено с ошибкой.")
    JOB.update(running=False, done=True, ok=ok)


def git(cmd):
    try:
        r = subprocess.run(["git"] + cmd, cwd=ROOT, capture_output=True, text=True, timeout=180)
        return (r.returncode == 0, (r.stdout + r.stderr).strip())
    except Exception as e:
        return (False, str(e))


# ---------------- HTTP ----------------
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    # --- helpers ---
    def _token(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return c["ae_admin"].value if "ae_admin" in c else None

    def _authed(self):
        tok = self._token()
        if tok and tok in SESSIONS and time.time() - SESSIONS[tok] < SESSION_TTL:
            return True
        return False

    def _send(self, code, body=b"", ctype="application/json", cookie=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    # --- GET ---
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/admin", "/admin/", "/"):
            return self._serve_file(os.path.join(HERE, "app.html"), "text/html; charset=utf-8")
        if path == "/admin/api/me":
            return self._json(200, {"authed": self._authed()})
        if path.startswith("/admin/api/"):
            if not self._authed():
                return self._json(401, {"error": "unauthorized"})
            if path == "/admin/api/stats":
                return self._json(200, compute_stats())
            if path == "/admin/api/catalog":
                return self._json(200, read_catalog())
            if path == "/admin/api/run-status":
                return self._json(200, JOB)
            return self._json(404, {"error": "not found"})
        # статика проекта (превью фото в редакторе) — только существующие файлы внутри ROOT
        return self._serve_static(path)

    # --- POST ---
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/admin/api/login":
            b = self._body()
            if verify(b.get("user", ""), b.get("pass", "")):
                tok = secrets.token_hex(24)
                SESSIONS[tok] = time.time()
                return self._send(200, '{"ok":true}', "application/json; charset=utf-8",
                                  cookie=f"ae_admin={tok}; Path=/; HttpOnly; SameSite=Lax")
            return self._json(401, {"ok": False, "error": "Неверный логин или пароль"})
        if path == "/admin/api/logout":
            tok = self._token()
            SESSIONS.pop(tok, None)
            return self._send(200, '{"ok":true}', cookie="ae_admin=; Path=/; Max-Age=0")
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        if path == "/admin/api/catalog":
            return self._save_catalog(self._body())
        if path == "/admin/api/run-parser":
            if JOB["running"]:
                return self._json(409, {"error": "уже выполняется"})
            b = self._body()
            threading.Thread(target=run_pipeline, kwargs={
                "pages": int(b.get("pages", 1)), "limit": int(b.get("limit", 18)),
                "gallery": bool(b.get("gallery", True))}, daemon=True).start()
            return self._json(200, {"started": True})
        if path == "/admin/api/publish":
            b = self._body()
            msg = (b.get("message") or "Обновление каталога через админку").strip()
            ok1, l1 = git(["add", "-A"])
            ok2, l2 = git(["commit", "-m", msg])
            ok3, l3 = git(["push"])
            return self._json(200, {"ok": ok3, "log": "\n".join(filter(None, [l1, l2, l3]))})
        return self._json(404, {"error": "not found"})

    def _save_catalog(self, body):
        items = body.get("items")
        if not isinstance(items, list):
            return self._json(400, {"error": "items?"})
        d = read_catalog()
        d["items"] = items
        json.dump(d, open(CATALOG, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        return self._json(200, {"ok": True, "count": len(items)})

    def _serve_file(self, fp, ctype):
        if not os.path.exists(fp):
            return self._send(404, "not found", "text/plain")
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)

    def _serve_static(self, path):
        rel = path.lstrip("/")
        fp = os.path.normpath(os.path.join(ROOT, rel))
        if not fp.startswith(ROOT) or not os.path.isfile(fp):
            return self._send(404, "not found", "text/plain")
        ext = os.path.splitext(fp)[1].lower()
        ctype = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                 ".webp": "image/webp", ".css": "text/css", ".js": "application/javascript",
                 ".json": "application/json", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8",
                 ".mp4": "video/mp4"}.get(ext, "application/octet-stream")
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def main():
    args = sys.argv[1:]
    if "--set-user" in args or "--set-pass" in args:
        def val(flag, default=None):
            return args[args.index(flag) + 1] if flag in args else default
        cfg = json.load(open(CONFIG)) if os.path.exists(CONFIG) else {"user": "admin"}
        user = val("--set-user", cfg.get("user", "admin"))
        pw = val("--set-pass")
        if not pw:
            print("Укажите --set-pass ПАРОЛЬ"); return
        save_config(user, pw)
        print(f"✓ Аккаунт обновлён: логин «{user}».")
        return
    load_config()  # создаст аккаунт при первом запуске и напечатает пароль
    print(f"Art Estate Admin → http://{HOST}:{PORT}/admin/   (Ctrl+C для остановки)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
