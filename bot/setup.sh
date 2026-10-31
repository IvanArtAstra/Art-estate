#!/usr/bin/env bash
# ============================================================
#  Estate Art — настройка моста «чат на сайте ↔ Telegram»
#  Бот: @EstateArtHomesBot
# ------------------------------------------------------------
#  Запускать из корня проекта:  bash bot/setup.sh
#
#  Секреты вводятся с клавиатуры и живут только в этом процессе
#  и в хранилище секретов Cloudflare. Скрипт не пишет их в файлы,
#  не кладёт в историю команд и не передаёт никуда, кроме
#  Cloudflare и api.telegram.org.
#
#  Это важно не из перестраховки: репозиторий публичный. Токен,
#  попавший в любой файл здесь, уводят в первые же часы.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/bot"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v wrangler >/dev/null 2>&1 || die "wrangler не установлен. Сначала: npm install -g wrangler && wrangler login"
wrangler whoami >/dev/null 2>&1 || die "Нет входа в Cloudflare. Выполните: wrangler login"

# ---------- 1. Хранилище переписки ----------
if grep -q 'ЗАМЕНИТЕ_НА_ID' wrangler.toml; then
  say "1/6 Создаю хранилище переписки (KV)…"
  out="$(wrangler kv namespace create CHAT 2>&1)" || { echo "$out"; die "не удалось создать KV"; }
  kv_id="$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$kv_id" ] || { echo "$out"; die "не нашёл id хранилища в ответе — впишите его в wrangler.toml вручную"; }
  # разделитель | — в id встречается только hex, конфликта не будет
  sed -i.bak "s|ЗАМЕНИТЕ_НА_ID_ИЗ_KV_NAMESPACE_CREATE|$kv_id|" wrangler.toml && rm -f wrangler.toml.bak
  echo "  ✓ id хранилища вписан в wrangler.toml"
else
  say "1/6 Хранилище уже прописано в wrangler.toml — пропускаю"
fi

# ---------- 2. Секреты ----------
say "2/6 Секреты. Вводите значения в приглашениях wrangler — они идут прямо в Cloudflare."
echo "  BOT_TOKEN — токен от @BotFather для @EstateArtHomesBot"
wrangler secret put BOT_TOKEN

WEBHOOK_SECRET="$(openssl rand -hex 16)"
printf '%s' "$WEBHOOK_SECRET" | wrangler secret put WEBHOOK_SECRET
echo "  ✓ WEBHOOK_SECRET сгенерирован случайно — запоминать не нужно"

echo
echo "  ANTHROPIC_API_KEY — ключ Claude для первичного менеджера."
echo "  Пропустите (Ctrl-C на приглашении), если менеджер пока не нужен:"
echo "  без ключа бот работает как простой мост до дежурного."
wrangler secret put ANTHROPIC_API_KEY || echo "  … пропущено, менеджер выключен"

echo
echo "  AGENT_CHAT_ID — кому падают заявки. Несколько дежурных — через запятую."
echo "  Свой id: напишите боту /start, затем откройте"
echo "  https://api.telegram.org/bot<ТОКЕН>/getUpdates и возьмите message.chat.id"
wrangler secret put AGENT_CHAT_ID

# ---------- 3. Деплой ----------
say "3/6 Выкатываю воркер…"
deploy_out="$(wrangler deploy 2>&1)" || { echo "$deploy_out"; die "деплой не прошёл"; }
echo "$deploy_out" | tail -5
WORKER_URL="$(printf '%s' "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$WORKER_URL" ] || die "не нашёл адрес воркера в выводе деплоя"
echo "  ✓ воркер: $WORKER_URL"

# ---------- 4. Вебхук ----------
say "4/6 Подписываю бота на вебхук."
echo -n "  Вставьте токен бота ещё раз (не отобразится): "
read -rs TG_TOKEN
echo
hook="$(curl -sS -X POST "https://api.telegram.org/bot${TG_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"${WORKER_URL}/api/telegram\",\"secret_token\":\"${WEBHOOK_SECRET}\",\"allowed_updates\":[\"message\"]}")"
me="$(curl -sS "https://api.telegram.org/bot${TG_TOKEN}/getMe")"
unset TG_TOKEN
printf '  вебхук: %s\n' "$hook"
printf '  бот:    %s\n' "$me"
printf '%s' "$hook" | grep -q '"ok":true' || die "вебхук не встал — смотрите ответ выше"

# ---------- 5. Адрес воркера на сайте ----------
say "5/6 Прописываю адрес воркера в index.html…"
python3 - "$WORKER_URL" <<'PY'
import io, re, sys
url = sys.argv[1]
p = "index.html"
s = io.open(p, encoding="utf-8").read()
s2 = re.sub(r'data-chat-endpoint="[^"]*"', 'data-chat-endpoint="%s"' % url, s, count=1)
if s2 == s:
    sys.exit("не нашёл data-chat-endpoint в index.html")
io.open(p, "w", encoding="utf-8").write(s2)
print("  ✓ data-chat-endpoint = " + url)
PY

# ---------- 6. Проверка ----------
say "6/6 Проверяю, что воркер отвечает…"
health="$(curl -sS --max-time 15 "${WORKER_URL}/api/health" || true)"
printf '  /api/health: %s\n' "$health"
printf '%s' "$health" | grep -q '"ok":true' || die "воркер не отвечает — смотрите wrangler tail"

cat <<EOF

✓ Готово.

Осталось вручную:
  1. Закоммитить index.html — адрес воркера теперь в разметке:
       git add index.html && git commit -m "Чат на сайте подключён к боту" && git push
  2. Проверить сквозной путь: открыть сайт, написать в чат,
     получить сообщение в Telegram, ответить на него РЕПЛАЕМ.

Воркер: $WORKER_URL
Бот:    https://t.me/EstateArtHomesBot
EOF
