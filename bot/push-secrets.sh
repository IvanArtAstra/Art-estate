#!/usr/bin/env bash
# ============================================================
#  Загружает bot/.secrets.env в секреты Cloudflare.
#
#      bash bot/push-secrets.sh            # залить и поставить вебхук
#      bash bot/push-secrets.sh --unhook   # снять вебхук (чтобы работал getUpdates)
#
#  Файл с секретами в git не попадает — он закрыт в .gitignore.
#  После заливки скрипт предлагает его затереть: на диске он больше
#  не нужен, значения живут в Cloudflare.
# ============================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENVFILE="bot/.secrets.env"
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$ENVFILE" ] || die "Нет $ENVFILE — скопируйте bot/.secrets.env.example и заполните"
command -v wrangler >/dev/null 2>&1 || die "wrangler не установлен: npm install -g wrangler"
# whoami возвращает 0 и без входа, поэтому читаем вывод
wrangler whoami 2>&1 | grep -qi 'not authenticated' && die "Нет входа в Cloudflare: wrangler login"

# shellcheck disable=SC1090
set -a; . "./$ENVFILE"; set +a

if [ "${1:-}" = "--unhook" ]; then
  [ -n "${BOT_TOKEN:-}" ] || die "в $ENVFILE пустой BOT_TOKEN"
  curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" && echo
  echo "Вебхук снят — теперь работает bash bot/chat-id.sh. Вернуть: bash bot/push-secrets.sh"
  exit 0
fi

[ -n "${BOT_TOKEN:-}" ] || die "в $ENVFILE пустой BOT_TOKEN — без него бот не заработает"
[ -n "${AGENT_CHAT_ID:-}" ] || die "в $ENVFILE пустой AGENT_CHAT_ID — заявкам некуда падать (bash bot/chat-id.sh)"
if [ -z "${WEBHOOK_SECRET:-}" ]; then
  WEBHOOK_SECRET="$(openssl rand -hex 16)"
  echo "WEBHOOK_SECRET не задан — сгенерировал случайный, запоминать не нужно"
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY пуст — первичный менеджер будет выключен,"
  echo "бот заработает простым мостом до дежурного. Включается этим же файлом."
fi

# ---------- хранилище ----------
if grep -q 'ЗАМЕНИТЕ_НА_ID' bot/wrangler.toml; then
  say "Создаю хранилище переписки (KV)…"
  out="$(cd bot && wrangler kv namespace create CHAT 2>&1)" || { echo "$out"; die "не удалось создать KV"; }
  kv_id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$kv_id" ] || { echo "$out"; die "не нашёл id хранилища — впишите его в bot/wrangler.toml вручную"; }
  sed -i.bak "s|ЗАМЕНИТЕ_НА_ID_ИЗ_KV_NAMESPACE_CREATE|$kv_id|" bot/wrangler.toml && rm -f bot/wrangler.toml.bak
  echo "  ✓ id хранилища вписан в bot/wrangler.toml"
fi

# ---------- секреты одним запросом ----------
say "Заливаю секреты в Cloudflare…"
payload="BOT_TOKEN=${BOT_TOKEN}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
AGENT_CHAT_ID=${AGENT_CHAT_ID}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && payload="${payload}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
# Через stdin, а не файлом: значения не оказываются во временном файле
printf '%s\n' "$payload" | (cd bot && wrangler secret bulk) || die "не удалось залить секреты"

# ---------- деплой ----------
say "Выкатываю воркер…"
deploy_out="$(cd bot && wrangler deploy 2>&1)" || { echo "$deploy_out"; die "деплой не прошёл"; }
echo "$deploy_out" | tail -4
WORKER_URL="$(printf '%s' "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$WORKER_URL" ] || die "не нашёл адрес воркера в выводе деплоя"

# ---------- вебхук ----------
say "Подписываю бота на вебхук…"
hook="$(curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"${WORKER_URL}/api/telegram\",\"secret_token\":\"${WEBHOOK_SECRET}\",\"allowed_updates\":[\"message\"]}")"
printf '  %s\n' "$hook"
printf '%s' "$hook" | grep -q '"ok":true' || die "вебхук не встал — смотрите ответ выше"
me="$(curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getMe")"
printf '  бот: %s\n' "$(printf '%s' "$me" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("@"+d["result"]["username"] if d.get("ok") else d)')"

# ---------- адрес воркера на сайте ----------
say "Прописываю адрес воркера в index.html…"
WORKER_URL="$WORKER_URL" python3 - <<'PY'
import io, os, re, sys
url = os.environ["WORKER_URL"]
s = io.open("index.html", encoding="utf-8").read()
s2 = re.sub(r'data-chat-endpoint="[^"]*"', 'data-chat-endpoint="%s"' % url, s, count=1)
if s2 == s:
    sys.exit("не нашёл data-chat-endpoint в index.html")
io.open("index.html", "w", encoding="utf-8").write(s2)
print("  ✓ data-chat-endpoint = " + url)
PY

# ---------- проверка ----------
say "Проверяю воркер…"
health="$(curl -sS --max-time 15 "${WORKER_URL}/api/health" || true)"
printf '  /api/health: %s\n' "$health"
printf '%s' "$health" | grep -q '"ok":true' || die "воркер не отвечает — смотрите: cd bot && wrangler tail"

say "Готово."
cat <<EOF
Воркер: $WORKER_URL
Бот:    https://t.me/EstateArtHomesBot

Дальше:
  1. git add index.html bot/wrangler.toml && git commit -m "Чат на сайте подключён к боту" && git push
  2. Откройте https://estateart.homes/, напишите в чат — ответит первичный
     менеджер; когда он соберёт контакт, карточка придёт в Telegram.
EOF

printf '\nЗатереть %s? Значения уже в Cloudflare. [y/N] ' "$ENVFILE"
read -r ans
case "$ans" in
  [yY]*) : > "$ENVFILE"; echo "Файл очищен. Шаблон остался в bot/.secrets.env.example";;
  *)     echo "Оставил. В git он не попадёт, но и на диске ему без нужды делать нечего.";;
esac
