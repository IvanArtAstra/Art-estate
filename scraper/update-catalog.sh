#!/usr/bin/env bash
# Обновление каталога Art Estate данными с fazwaz.ru.
# Запуск вручную:   bash scraper/update-catalog.sh
# По расписанию:    см. инструкцию ниже и scraper/README.md
set -euo pipefail

# Каталог проекта (папка на уровень выше этого скрипта)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PAGES="${PAGES:-1}"
LIMIT="${LIMIT:-18}"
DELAY="${DELAY:-0.9}"
CATEGORY="${CATEGORY:-/недвижимость-продажа/таиланд/пхукет}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Обновляю каталог: pages=$PAGES limit=$LIMIT"
python3 scraper/scrape_fazwaz.py \
  --category "$CATEGORY" \
  --pages "$PAGES" \
  --limit "$LIMIT" \
  --delay "$DELAY"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Генерирую SEO-страницы объектов…"
python3 scraper/build_pages.py

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Готово. Не забудьте: git add -A && git commit && git push"

# ─────────────────────────────────────────────────────────────────────────────
# ЗАПУСК ПО РАСПИСАНИЮ
#
# Вариант 1 — cron (раз в сутки в 06:00):
#   crontab -e
#   0 6 * * * /bin/bash "/Users/ivanartemev/Desktop/проекты/Art Estate/scraper/update-catalog.sh" >> "/tmp/art-estate-catalog.log" 2>&1
#
# Вариант 2 — launchd (macOS, надёжнее для ноутбука):
#   создайте ~/Library/LaunchAgents/ru.artestate.catalog.plist с ProgramArguments,
#   указывающими на этот скрипт, и StartCalendarInterval (пример — в scraper/README.md),
#   затем:  launchctl load ~/Library/LaunchAgents/ru.artestate.catalog.plist
#
# Вариант 3 — Claude Code: команда /schedule (удалённый агент по cron).
# ─────────────────────────────────────────────────────────────────────────────
