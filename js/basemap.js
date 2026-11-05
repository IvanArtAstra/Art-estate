/* ============================================================
   Estate Art — подложка карт.

   Тайлы свои: вырезка из дневной сборки Protomaps лежит одним файлом
   .pmtiles на нашем Cloudflare R2. Это не прихоть — у публичного
   тайл-сервера OpenStreetMap в правилах прямо сказано, что
   коммерческим сайтам доступ могут отозвать без предупреждения.

   Два следствия помимо независимости: карта рисуется в палитре сайта,
   а не чужой, и подписи идут по-русски даже в Таиланде и Вьетнаме —
   векторные тайлы несут все языки сразу.

   Если файл недоступен или не подгрузился protomaps-leaflet, карта
   молча падает обратно на растровый OpenStreetMap: лучше чужая
   картинка, чем пустой прямоугольник на странице объекта.

   Как пересобрать тайлы — tools/tiles/README.md.
   ============================================================ */
(function () {
  'use strict';

  /* Адрес файла тайлов. Пусто — работаем на растре OSM, как раньше. */
  var TILES = '';

  var OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>';
  var PM_ATTR = '<a href="https://protomaps.com" rel="noopener">Protomaps</a> ' + OSM_ATTR;

  /* Палитра карты собрана из токенов сайта: песок вместо серого, вода
     приглушённая, дороги кремовые, подписи — чернила сайта. Ключи и
     базовые значения взяты из светлой темы protomaps-leaflet. */
  var FLAVOR = {
    background: '#ece3d2',
    earth: '#f6f1e7',
    park_a: '#e8e8d9',
    park_b: '#d9ded0',
    hospital: '#efe9dc',
    industrial: '#efe9dc',
    school: '#efe9dc',
    wood_a: '#e6e9db',
    wood_b: '#d6dccc',
    pedestrian: '#efe9dc',
    scrub_a: '#e9e7d8',
    scrub_b: '#dcdccb',
    glacier: '#f4f2ec',
    sand: '#f1e9d6',
    beach: '#efe3c9',
    aerodrome: '#efe9dc',
    runway: '#e6ded0',
    water: '#c3d4d2',
    zoo: '#e6e9db',
    military: '#efe9dc',
    tunnel_other_casing: '#ded2bd',
    tunnel_minor_casing: '#ded2bd',
    tunnel_link_casing: '#ded2bd',
    tunnel_major_casing: '#ded2bd',
    tunnel_highway_casing: '#ded2bd',
    tunnel_other: '#fffdf8',
    tunnel_minor: '#fffdf8',
    tunnel_link: '#fffdf8',
    tunnel_major: '#fffdf8',
    tunnel_highway: '#fffdf8',
    pier: '#e6ded0',
    buildings: '#e7dece',
    minor_service_casing: '#ded2bd',
    minor_casing: '#ded2bd',
    link_casing: '#ded2bd',
    major_casing_late: '#ded2bd',
    highway_casing_late: '#ded2bd',
    other: '#fffdf8',
    minor_service: '#fffdf8',
    minor_a: '#fffdf8',
    minor_b: '#fffdf8',
    link: '#fffdf8',
    major_casing_early: '#ded2bd',
    major: '#fffdf8',
    highway_casing_early: '#ded2bd',
    highway: '#fffdf8',
    railway: '#cfc3ad',
    boundaries: '#b9a98c',
    bridges_other_casing: '#ded2bd',
    bridges_minor_casing: '#ded2bd',
    bridges_link_casing: '#ded2bd',
    bridges_major_casing: '#ded2bd',
    bridges_highway_casing: '#ded2bd',
    bridges_other: '#fffdf8',
    bridges_minor: '#fffdf8',
    bridges_link: '#fffdf8',
    bridges_major: '#fffdf8',
    bridges_highway: '#fffdf8',
    roads_label_minor: '#38514d',
    roads_label_minor_halo: '#fffdf8',
    roads_label_major: '#14201f',
    roads_label_major_halo: '#fffdf8',
    ocean_label: '#38514d',
    subplace_label: '#38514d',
    subplace_label_halo: '#fffdf8',
    city_label: '#14201f',
    city_label_halo: '#fffdf8',
    state_label: '#38514d',
    state_label_halo: '#fffdf8',
    country_label: '#0f3f3a',
    address_label: '#38514d',
    address_label_halo: '#fffdf8',
    pois: '#38514d',
    /* Крупный план с высоты: на обзорной карте видно именно это,
       поэтому цвета те же, что у парков и песка, только мягче */
    landcover: {
      grassland: '#e9ebda',
      barren: '#f1e9d6',
      urban_area: '#ebe4d6',
      farmland: '#ecedd9',
      glacier: '#f4f2ec',
      scrub: '#e9e7d8',
      forest: '#e0e6d5'
    }
  };

  function url() {
    var attr = document.body && document.body.dataset ? document.body.dataset.basemap : '';
    return (attr || TILES || '').trim();
  }

  function lang() {
    var l = (document.documentElement.lang || 'ru').slice(0, 2);
    return l === 'th' || l === 'en' ? l : 'ru';
  }

  /* Leaflet 1.9 зашивает в подпись украинский флаг — SVG лежит прямо в
     leaflet.js. Политическая картинка в карточке объекта не наше
     сообщение, поэтому подпись своя: кредит библиотеке остаётся. */
  function credit() {
    if (typeof L === 'undefined') return;
    L.Control.Attribution.prototype.options.prefix =
      '<a href="https://leafletjs.com" rel="noopener">Leaflet</a>';
  }

  function attach(map, opts) {
    if (typeof L === 'undefined' || !map) return null;
    credit();
    var src = url();
    var maxZoom = (opts && opts.maxZoom) || 18;

    if (src && window.protomapsL && window.protomapsL.leafletLayer) {
      try {
        var layer = window.protomapsL.leafletLayer({
          url: src,
          /* Сборка Protomaps заканчивается на 15-м зуме. Дальше тайл
             растягивается — для вектора это не каша из пикселей, а та же
             чёткая графика крупнее. */
          maxDataZoom: 15,
          maxZoom: maxZoom,
          paintRules: window.protomapsL.paintRules(FLAVOR),
          labelRules: window.protomapsL.labelRules(FLAVOR, lang()),
          backgroundColor: FLAVOR.background,
          attribution: PM_ATTR,
        });
        layer.addTo(map);
        return layer;
      } catch (e) {
        /* Падаем на растр: страница объекта без карты хуже, чем с чужой */
        if (window.console) console.warn('basemap:', e && e.message);
      }
    }

    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: maxZoom, attribution: OSM_ATTR }).addTo(map);
  }

  window.Basemap = { attach: attach, credit: credit, flavor: FLAVOR };
})();
