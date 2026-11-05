#!/bin/bash
# Своя подложка Estate Art.
#
# Вырезаем из дневной сборки Protomaps только то, что показываем, и
# склеиваем в один файл для Cloudflare R2. Файл держим меньше 300 МБ —
# это потолок загрузки через веб-панель R2, и он избавляет от rclone.
#
# Слои не пересекаются ни по зуму, ни по площади: pmtiles merge
# склеивает только непересекающиеся архивы.
#
#   brew install pmtiles
#   bash tools/tiles/build.sh
#
set -e
cd "$(dirname "$0")"

# Свежую сборку смотреть на https://maps.protomaps.com/builds
BUILD=${BUILD:-20261104}
SRC=https://build.protomaps.com/$BUILD.pmtiles
T=${THREADS:-8}
OUT=estateart-basemap.pmtiles

# Весь мир крупно: обзорная карта не должна зиять дырами
pmtiles extract $SRC p-world.pmtiles --maxzoom=6 --download-threads=$T
# Таиланд и Вьетнам — до уровня городов
pmtiles extract $SRC p-sea.pmtiles --bbox=95,4,113,24 --minzoom=7 --maxzoom=10 --download-threads=$T
# Турция: Аланья ещё впереди, но подложку готовим заранее
pmtiles extract $SRC p-tur.pmtiles --bbox=25,35,45,43 --minzoom=7 --maxzoom=10 --download-threads=$T
# Наши районы — до домов. Дальше 15-го зума вектор растягивается без потери резкости
pmtiles extract $SRC p-regions.pmtiles --region=regions.geojson --minzoom=11 --maxzoom=15 --download-threads=$T

rm -f $OUT
pmtiles merge p-world.pmtiles p-sea.pmtiles p-tur.pmtiles p-regions.pmtiles $OUT
pmtiles verify $OUT
rm -f p-world.pmtiles p-sea.pmtiles p-tur.pmtiles p-regions.pmtiles
ls -lh $OUT
