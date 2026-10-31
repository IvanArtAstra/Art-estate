#!/usr/bin/env bash
# Показывает chat_id тех, кто недавно писал боту: личные чаты и группы.
# Токен берётся из bot/.secrets.env и в командную строку не попадает —
# иначе он осел бы в истории shell и в списке процессов.
#
#   bash bot/chat-id.sh
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -f bot/.secrets.env ] || { echo "Нет bot/.secrets.env — скопируйте bot/.secrets.env.example" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./bot/.secrets.env; set +a
[ -n "${BOT_TOKEN:-}" ] || { echo "В bot/.secrets.env пустой BOT_TOKEN" >&2; exit 1; }

echo "Спрашиваю Telegram, кто писал боту…"
resp="$(curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates")"

# Ответ передаём переменной окружения, а не аргументом и не вторым stdin:
# аргумент осел бы в списке процессов, а два перенаправления конфликтуют.
TG_RESP="$resp" python3 - <<'PY'
import json, os, sys
try:
    d = json.loads(os.environ.get("TG_RESP") or "")
except Exception:
    sys.exit("Ответ Telegram не разобрался — проверьте токен.")
if not d.get("ok"):
    sys.exit("Telegram отказал: %s" % d.get("description"))

seen = {}
for u in d.get("result", []):
    m = u.get("message") or u.get("edited_message") or u.get("my_chat_member") or {}
    c = m.get("chat") or {}
    if c.get("id") is None:
        continue
    title = c.get("title") or " ".join(x for x in [c.get("first_name"), c.get("last_name")] if x) or c.get("username") or "—"
    seen[c["id"]] = (c.get("type"), title)

if not seen:
    print("\nTelegram ничего не помнит.")
    print("Напишите боту /start в личке или что-нибудь в группе, где он админ,")
    print("и запустите снова. Вебхук, если он уже стоит, забирает обновления")
    print("себе — тогда снимите его на минуту: bash bot/push-secrets.sh --unhook")
    raise SystemExit(0)

print("\nAGENT_CHAT_ID — возьмите нужное:\n")
for cid, (kind, title) in seen.items():
    mark = "группа" if str(kind).endswith("group") else ("канал" if kind == "channel" else "личка")
    print("  %-16s %-8s %s" % (cid, mark, title))
print("\nНесколько дежурных — через запятую, например: %s" % ",".join(str(k) for k in list(seen)[:2]))
print("Для группы минус в начале id обязателен.")
PY
