#!/usr/bin/env bash
# ============================================================
#  Проверка связей бота: токен, чаты дежурных, вебхук, ключ Claude.
#  Значения секретов не печатает — только вердикты.
#
#      bash bot/doctor.sh
# ============================================================
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENVFILE="bot/.secrets.env"
[ -f "$ENVFILE" ] || { echo "Нет $ENVFILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$ENVFILE"; set +a

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ -z "${BOT_TOKEN:-}" ]; then
  [ -t 0 ] || { echo "BOT_TOKEN пуст" >&2; exit 1; }
  printf 'Токен бота (ввод не отображается): '; read -rs BOT_TOKEN; printf '\n'
fi

head_ "Бот"
me="$(curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getMe")"
if printf '%s' "$me" | grep -q '"ok":true'; then
  ok "$(printf '%s' "$me" | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("@"+d["username"]+" (id "+str(d["id"])+")")')"
else
  bad "токен не принят: $(printf '%s' "$me" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("description"))' 2>/dev/null)"
fi

head_ "Чаты дежурных (AGENT_CHAT_ID)"
if [ -z "${AGENT_CHAT_ID:-}" ]; then
  bad "не задан — заявкам некуда падать"
else
  IFS=',' read -ra IDS <<< "$AGENT_CHAT_ID"
  for raw in "${IDS[@]}"; do
    cid="$(printf '%s' "$raw" | tr -d '[:space:]')"
    [ -n "$cid" ] || continue
    r="$(curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${cid}")"
    if printf '%s' "$r" | grep -q '"ok":true'; then
      ok "$cid — $(printf '%s' "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print(d.get("type","?")+": "+(d.get("title") or d.get("username") or d.get("first_name") or "—"))')"
      # Проверяем, что бот реально может писать: пробуем действие «печатает»
      a="$(curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction" \
            -H 'content-type: application/json' -d "{\"chat_id\":\"${cid}\",\"action\":\"typing\"}")"
      printf '%s' "$a" | grep -q '"ok":true' && ok "  писать в него может" \
        || bad "  писать не может: $(printf '%s' "$a" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("description"))' 2>/dev/null)"
    else
      d="$(printf '%s' "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("description"))' 2>/dev/null)"
      bad "$cid — $d"
      case "$cid" in
        -100*) echo "      id супергруппы выглядит верно: проверьте, что бот всё ещё в ней состоит" ;;
        -*)    echo "      для супергруппы id обычно начинается на -100; этот короче — возможно, старый формат" ;;
        *)     echo "      id положительный, то есть личный чат: напишите боту /start, иначе он не вправе писать первым" ;;
      esac
    fi
  done
fi

head_ "Вебхук"
w="$(curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")"
TG_W="$w" python3 - <<'PY'
import json, os, sys
d = json.loads(os.environ.get("TG_W") or "{}").get("result", {})
url = d.get("url") or ""
print(("  \033[32m✓\033[0m " if url else "  \033[31m✗\033[0m ") + ("стоит: " + url if url else "не стоит"))
if d.get("last_error_message"):
    print("  \033[31m✗\033[0m последняя ошибка доставки: " + d["last_error_message"])
if d.get("pending_update_count"):
    print("    необработанных обновлений: %d" % d["pending_update_count"])
PY

head_ "Ключ Anthropic"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "  не задан — первичный менеджер выключен, бот работает мостом до дежурного"
else
  code="$(curl -sS -o /tmp/anthropic_probe.json -w '%{http_code}' \
    -X POST https://api.anthropic.com/v1/messages \
    -H 'content-type: application/json' \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H 'anthropic-version: 2023-06-01' \
    -d '{"model":"claude-sonnet-5-5","max_tokens":4,"messages":[{"role":"user","content":"ping"}]}')"
  if [ "$code" = "200" ]; then
    ok "ключ принят, модель claude-sonnet-5-5 доступна"
  else
    bad "HTTP $code — $(python3 -c 'import json;d=json.load(open("/tmp/anthropic_probe.json"));e=d.get("error",{});print(e.get("type","?")+": "+e.get("message","?"))' 2>/dev/null || cat /tmp/anthropic_probe.json)"
    case "$code" in
      401) echo "      ключ неверный или отозван" ;;
      403) echo "      ключ есть, но запрос запрещён: чаще всего это не ключ Anthropic API"
           echo "      (нужен из console.anthropic.com → API keys, он начинается на sk-ant-api)," 
           echo "      либо у аккаунта нет средств, либо ключ ограничен по источнику" ;;
      404) echo "      модели нет у этого аккаунта — поменяйте MODEL в bot/ai.js" ;;
      429) echo "      лимит запросов" ;;
    esac
  fi
  rm -f /tmp/anthropic_probe.json
fi
echo
