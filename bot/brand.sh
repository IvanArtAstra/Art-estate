#!/usr/bin/env bash
# ============================================================
#  Оформление @EstateArtHomesBot через Bot API.
#
#      bash bot/brand.sh
#
#  Ставит имя, описание на пустом экране, строку «о боте»,
#  команды и кнопку меню — по-русски и по-английски.
#
#  Аватар сюда не входит: его Bot API менять не умеет, только
#  BotFather командой /setuserpic. Файл готовит bot/avatar.sh.
# ============================================================
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENVFILE="bot/.secrets.env"
[ -f "$ENVFILE" ] || { echo "Нет $ENVFILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$ENVFILE"; set +a
if [ -z "${BOT_TOKEN:-}" ]; then
  [ -t 0 ] || { echo "BOT_TOKEN пуст" >&2; exit 1; }
  printf 'Токен бота (ввод не отображается): '; read -rs BOT_TOKEN; printf '\n'
fi
SITE="${SITE_URL:-https://estateart.homes/}"

api() {
  local method="$1" payload="$2" label="$3"
  local r; r="$(curl -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/${method}" \
    -H 'content-type: application/json' -d "$payload")"
  if printf '%s' "$r" | grep -q '"ok":true'; then
    printf '  \033[32m✓\033[0m %s\n' "$label"
  else
    printf '  \033[31m✗\033[0m %s — %s\n' "$label" \
      "$(printf '%s' "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("description"))' 2>/dev/null)"
  fi
}

# Строки собираем в Python: так не нужно вручную экранировать кавычки,
# переводы строк и неразрывные пробелы внутри JSON
payload() { SITE="$SITE" python3 - "$@"; }

printf '\n\033[1mИмя\033[0m\n'
api setMyName '{"name":"Estate Art — Пхукет и Вьетнам"}' 'русское'
api setMyName '{"name":"Estate Art — Phuket & Vietnam","language_code":"en"}' 'английское'

printf '\n\033[1mОписание на пустом экране\033[0m\n'
DESC_RU=$(payload <<'PY'
import json
print(json.dumps({"description":
"Виллы и квартиры на Пхукете, в Дананге и Нячанге.\n\n"
"Подбираем объект под задачу — жить, сдавать или держать, — проверяем документы "
"и ведём сделку от первого показа до ключей. Работаем удалённо: онлайн-показы, "
"видео-туры, сопровождение переводов.\n\n"
"Напишите, что ищете. Отвечу по рынку и передам агенту."}, ensure_ascii=False))
PY
)
api setMyDescription "$DESC_RU" 'русское'
DESC_EN=$(payload <<'PY'
import json
print(json.dumps({"language_code":"en","description":
"Villas and apartments in Phuket, Da Nang and Nha Trang.\n\n"
"We match the property to the purpose — to live in, to rent out or to hold — "
"check the paperwork and guide the deal from first viewing to keys. Remote "
"purchase is routine here: online viewings, video tours, transfer support.\n\n"
"Tell us what you are looking for."}, ensure_ascii=False))
PY
)
api setMyDescription "$DESC_EN" 'английское'

printf '\n\033[1mСтрока «о боте» в профиле\033[0m\n'
api setMyShortDescription \
  '{"short_description":"Недвижимость на Пхукете и во Вьетнаме. Подбор, проверка документов, сделка под ключ."}' 'русская'
api setMyShortDescription \
  '{"language_code":"en","short_description":"Property in Phuket and Vietnam. Matching, due diligence, end-to-end deal support."}' 'английская'

printf '\n\033[1mКоманды\033[0m\n'
CMD_RU=$(payload <<'PY'
import json
print(json.dumps({"commands":[
  {"command":"start","description":"Начать подбор"},
  {"command":"catalog","description":"Каталог объектов на сайте"},
  {"command":"contact","description":"Связаться с агентом"},
]}, ensure_ascii=False))
PY
)
api setMyCommands "$CMD_RU" 'русские'
CMD_EN=$(payload <<'PY'
import json
print(json.dumps({"language_code":"en","commands":[
  {"command":"start","description":"Start your search"},
  {"command":"catalog","description":"Browse the catalogue"},
  {"command":"contact","description":"Talk to an agent"},
]}, ensure_ascii=False))
PY
)
api setMyCommands "$CMD_EN" 'английские'

printf '\n\033[1mКнопка меню\033[0m\n'
MENU=$(payload <<'PY'
import json, os
site = os.environ["SITE"].rstrip("/") + "/"
print(json.dumps({"menu_button":{"type":"web_app","text":"Каталог",
  "web_app":{"url": site}}}, ensure_ascii=False))
PY
)
api setChatMenuButton "$MENU" 'открывает каталог'

printf '\n\033[1mСейчас на боте\033[0m\n'
for m in getMyName getMyShortDescription getMyDescription; do
  curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/${m}" | python3 -c '
import json,sys
d=json.load(sys.stdin).get("result",{})
for k,v in d.items(): print("  %s: %s" % (k, v if len(str(v))<110 else str(v)[:110]+"…"))'
done
echo
echo "Осталось вручную — аватар: @BotFather → /setuserpic → пришлите bot/avatar.png"
