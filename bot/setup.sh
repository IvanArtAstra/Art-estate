#!/usr/bin/env bash
# ============================================================
#  Estate Art — настройка моста «чат на сайте ↔ Telegram»
#  Бот: @EstateArtHomesBot
# ------------------------------------------------------------
#  Вся работа живёт в bot/push-secrets.sh — здесь только проверки
#  и подсказки. Две копии одной логики разъехались бы при первой
#  же правке, и чинить пришлось бы обе.
#
#      bash bot/setup.sh
# ============================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENVFILE="bot/.secrets.env"
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

command -v wrangler >/dev/null 2>&1 || {
  echo "Сначала поставьте wrangler:  npm install -g wrangler"; exit 1; }
# whoami возвращает 0 и без входа — приходится читать вывод, иначе скрипт
# доходил бы до заливки секретов и падал уже там
if wrangler whoami 2>&1 | grep -qi 'not authenticated'; then
  echo "Нет входа в Cloudflare. Выполните  wrangler login  и подтвердите в браузере."
  echo "Если окно не успевает — сначала войдите на dash.cloudflare.com, потом повторите."
  exit 1
fi

if [ ! -f "$ENVFILE" ]; then
  cp bot/.secrets.env.example "$ENVFILE"
  say "Создал $ENVFILE"
  echo "Заполните его и запустите снова. В git он не попадёт."
  exit 0
fi

# shellcheck disable=SC1090
set -a; . "./$ENVFILE"; set +a

missing=""
[ -n "${BOT_TOKEN:-}" ]     || missing="$missing BOT_TOKEN"
[ -n "${AGENT_CHAT_ID:-}" ] || missing="$missing AGENT_CHAT_ID"
if [ -n "$missing" ]; then
  say "В $ENVFILE не хватает:$missing"
  [ -n "${BOT_TOKEN:-}" ] && [ -z "${AGENT_CHAT_ID:-}" ] && {
    echo "Узнать AGENT_CHAT_ID:  bash bot/chat-id.sh"
    echo "Если бот уже на вебхуке, getUpdates молчит — снимите на минуту:"
    echo "  bash bot/push-secrets.sh --unhook"; }
  exit 1
fi

exec bash bot/push-secrets.sh
