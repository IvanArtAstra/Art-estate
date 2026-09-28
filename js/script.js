/* ============================================================
   ESTATE ART — интерактив
   ============================================================ */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Плавное проявление изображений карточек при загрузке
  document.addEventListener('load', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.target.classList.add('is-loaded');
  }, true);
  function markLoaded(root) {
    (root || document).querySelectorAll('.card__media img, .dcard img').forEach(im => { if (im.complete) im.classList.add('is-loaded'); });
  }

  /* ---------- ПРЕЛОАДЕР ---------- */
  const preloader = document.getElementById('preloader');
  const preloaderBar = document.getElementById('preloaderBar');
  let prog = 0;
  const fakeLoad = setInterval(() => {
    prog = Math.min(100, prog + Math.random() * 18);
    if (preloaderBar) preloaderBar.style.width = prog + '%';
    if (prog >= 100) clearInterval(fakeLoad);
  }, 130);
  window.addEventListener('load', () => {
    if (preloaderBar) preloaderBar.style.width = '100%';
    setTimeout(() => preloader && preloader.classList.add('hidden'), 500);
  });
  // подстраховка: убрать прелоадер даже если load не сработал
  setTimeout(() => preloader && preloader.classList.add('hidden'), 3500);

  /* ---------- ШАПКА ПРИ СКРОЛЛЕ ---------- */
  const header = document.getElementById('header');
  const onScrollHeader = () => {
    if (window.scrollY > 60) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });

  /* ---------- ПРОГРЕСС ПРОКРУТКИ + КНОПКА «НАВЕРХ» ---------- */
  const progressBar = document.getElementById('scrollProgress');
  const toTop = document.getElementById('toTop');
  function onScrollUI() {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    if (progressBar) progressBar.style.width = (p * 100).toFixed(2) + '%';
    if (toTop) toTop.classList.toggle('show', window.scrollY > window.innerHeight * 0.9);
  }
  onScrollUI();
  window.addEventListener('scroll', onScrollUI, { passive: true });
  window.addEventListener('resize', onScrollUI);
  toTop && toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  /* ---------- SCROLLSPY ---------- */
  const spyLinks = Array.from(document.querySelectorAll('.nav a[href^="#"], .drawer__nav a[href^="#"]'));
  const spyMap = {};
  spyLinks.forEach(a => { const id = a.getAttribute('href').slice(1); (spyMap[id] = spyMap[id] || []).push(a); });
  if ('IntersectionObserver' in window) {
    const spyIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          spyLinks.forEach(a => a.classList.remove('active'));
          (spyMap[e.target.id] || []).forEach(a => a.classList.add('active'));
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    Object.keys(spyMap).forEach(id => { const s = document.getElementById(id); if (s) spyIO.observe(s); });
  }

  /* ---------- ПАРАЛЛАКС (лёгкая глубина) ---------- */
  const parEls = Array.from(document.querySelectorAll('[data-parallax], [data-parallax-bg]'));
  if (!reduceMotion && parEls.length) {
    let parTick = false;
    function applyParallax() {
      const vh = window.innerHeight;
      parEls.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -120 || r.top > vh + 120) return;
        const off = (r.top + r.height / 2 - vh / 2) / vh; // ≈ -0.5..0.5
        if (el.hasAttribute('data-parallax')) {
          const k = parseFloat(el.getAttribute('data-parallax')) || 6;
          const base = el.classList.contains('whyus__video') ? 'scale(1.1) ' : '';
          el.style.transform = base + 'translateY(' + (-off * k).toFixed(2) + '%)';
        } else {
          const k = parseFloat(el.getAttribute('data-parallax-bg')) || 8;
          el.style.backgroundPosition = 'center calc(50% + ' + (-off * k).toFixed(2) + '%)';
        }
      });
      parTick = false;
    }
    window.addEventListener('scroll', () => { if (!parTick) { parTick = true; requestAnimationFrame(applyParallax); } }, { passive: true });
    window.addEventListener('resize', applyParallax);
    applyParallax();
  }

  /* ---------- БУРГЕР открывает боковое меню (см. логику drawer ниже) ---------- */

  /* ---------- HERO: СКРОЛЛ-СКРАБ ВИДЕО + СЛОИ ---------- */
  const heroTrack = document.getElementById('heroTrack');
  const heroVideo = document.getElementById('heroVideo');
  const scrollHint = document.getElementById('scrollHint');
  const layers = Array.from(document.querySelectorAll('.hero__layer'));

  let videoReady = false;
  let videoDuration = 0;

  if (heroVideo) {
    heroVideo.addEventListener('loadedmetadata', () => {
      videoDuration = heroVideo.duration || 0;
      videoReady = true;
      heroVideo.classList.add('ready');
      // нужно «пнуть» видео, чтобы первый кадр отрисовался
      try { heroVideo.currentTime = 0.001; } catch (e) {}
    });
    heroVideo.addEventListener('error', () => { videoReady = false; });
  }

  // Целевое и текущее время видео — для плавного догоняющего скраба
  let targetTime = 0;
  let curTime = 0;

  function heroProgress() {
    if (!heroTrack) return 0;
    const rect = heroTrack.getBoundingClientRect();
    const total = heroTrack.offsetHeight - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), total);
    return total > 0 ? scrolled / total : 0;
  }

  // Какой слой активен в зависимости от прогресса
  function updateLayers(p) {
    let idx;
    if (p < 0.34) idx = 1;        // акт 1: облёт острова
    else if (p < 0.68) idx = 2;   // акт 2: вилла → вход
    else idx = 3;                 // акт 3: влёт в интерьер
    layers.forEach(l => {
      l.classList.toggle('active', Number(l.dataset.layer) === idx);
    });
    if (scrollHint) scrollHint.style.opacity = p > 0.05 ? '0' : '1';
  }

  function onScrollHero() {
    const p = heroProgress();
    updateLayers(p);
    if (videoReady && videoDuration) {
      targetTime = p * (videoDuration - 0.05);
    }
  }
  window.addEventListener('scroll', onScrollHero, { passive: true });
  window.addEventListener('resize', onScrollHero);
  onScrollHero();

  // Плавный rAF-цикл скраба (lerp), чтобы видео скользило без рывков
  function rafScrub() {
    if (videoReady && videoDuration) {
      curTime += (targetTime - curTime) * 0.12;
      if (Math.abs(targetTime - curTime) > 0.01) {
        try { heroVideo.currentTime = curTime; } catch (e) {}
      }
    }
    requestAnimationFrame(rafScrub);
  }
  if (!reduceMotion) requestAnimationFrame(rafScrub);

  /* ---------- REVEAL ПРИ ПОЯВЛЕНИИ (переиспользуемый наблюдатель) ---------- */
  let revealIO = null;
  if ('IntersectionObserver' in window && !reduceMotion) {
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  }
  function observeReveal(els) {
    els.forEach(el => { if (revealIO) revealIO.observe(el); else el.classList.add('in'); });
  }
  observeReveal(Array.from(document.querySelectorAll('.reveal')));

  /* ======================================================================
     КАТАЛОГ: данные, поиск/фильтры, сравнение, карточка + калькуляторы
     ====================================================================== */
  const FALLBACK_CATALOG = { updated: null, source: null, items: [
    { title: 'Вилла Ocean Breeze', type: 'Вилла', priceLabel: 'от $590 000', priceUSD: 590000, beds: 3, baths: 3, area: 320, location: 'Камала, Пхукет', image: 'assets/villa.jpg', rentMonthUSD: 4200, description: 'Просторная вилла с бесконечным бассейном и видом на Андаманское море.', source_url: '#contacts' },
    { title: 'Резиденция Sea View', type: 'Квартира', priceLabel: 'от $210 000', priceUSD: 210000, beds: 2, baths: 2, area: 96, location: 'Банг Тао, Пхукет', image: 'assets/apartment.jpg', rentMonthUSD: 1500, description: 'Светлая квартира у моря в премиальном комплексе Банг Тао.', source_url: '#contacts' },
    { title: 'Пентхаус Sky Lagoon', type: 'Пентхаус', priceLabel: 'от $880 000', priceUSD: 880000, beds: 4, baths: 4, area: 280, location: 'Сурин, Пхукет', image: 'assets/penthouse.jpg', rentMonthUSD: 6000, description: 'Пентхаус с приватным бассейном на крыше и панорамой острова.', source_url: '#contacts' },
  ]};

  const grid = document.getElementById('catalogGrid');
  const fSearch = document.getElementById('fSearch');
  const fType = document.getElementById('fType');
  const fCity = document.getElementById('fCity');
  const fDistrict = document.getElementById('fDistrict');
  const fBeds = document.getElementById('fBeds');
  const fArea = document.getElementById('fArea');
  const pMin = document.getElementById('pMin');
  const pMax = document.getElementById('pMax');
  const priceLabel = document.getElementById('priceLabel');
  const fBeach = document.getElementById('fBeach');
  const fSort = document.getElementById('fSort');
  const fFav = document.getElementById('fFav');
  const fReset = document.getElementById('fReset');
  const catalogCount = document.getElementById('catalogCount');
  const catalogEmpty = document.getElementById('catalogEmpty');
  const catalogMore = document.getElementById('catalogMore');

  let allItems = [];
  let districtPages = null; // [{name,slug,url,count,image}] из catalog.json
  const compare = new Set();
  const MAX_COMPARE = 4;
  const PAGE_SIZE = 9;
  let shown = PAGE_SIZE;
  let favOnly = false;
  let beachOnly = false;
  let priceCeil = 0; // верхняя граница слайдера цены
  let country = ''; // '' | 'th' | 'vn' — выбранная страна
  try { const c = localStorage.getItem('ae_country'); if (c === 'th' || c === 'vn') country = c; } catch (e) {}

  const COUNTRIES = [
    { code: '', name: 'Все страны', nameEn: 'All countries', nameTh: 'ทุกประเทศ' },
    { code: 'th', name: 'Таиланд', nameEn: 'Thailand', nameTh: 'ไทย' },
    { code: 'vn', name: 'Вьетнам', nameEn: 'Vietnam', nameTh: 'เวียดนาม' },
  ];
  const CITY_I18N = {
    'Пхукет': { en: 'Phuket', th: 'ภูเก็ต' },
    'Дананг': { en: 'Da Nang', th: 'ดานัง' },
    'Нячанг': { en: 'Nha Trang', th: 'ญาจาง' },
  };
  function cityName(c) {
    const e = CITY_I18N[c];
    return (e && lang !== 'ru' && e[lang]) ? e[lang] : c;
  }
  function countryName(c) {
    const e = COUNTRIES.find(x => x.code === c) || COUNTRIES[0];
    return lang === 'en' ? e.nameEn : lang === 'th' ? e.nameTh : e.name;
  }

  // Избранное — в localStorage
  const FAV_KEY = 'ae_favorites';
  let favorites = new Set();
  try { favorites = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]').map(String)); } catch (e) {}
  function saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favorites))); } catch (e) {} }

  function district(it) { return (it.location || '').split(',')[0].trim(); }
  function grossYield(it) { const r = rentOf(it); return (r && it.priceUSD) ? (r * 12 / it.priceUSD * 100) : null; }

  // Валюта отображения (USD-база, приблизительные курсы — правятся здесь)
  const CURRENCIES = { USD: { sym: '$', rate: 1, after: false }, RUB: { sym: '₽', rate: 92, after: true }, THB: { sym: '฿', rate: 36.5, after: false } };
  let currency = 'USD';
  try { const c = localStorage.getItem('ae_currency'); if (c && CURRENCIES[c]) currency = c; } catch (e) {}
  function money(u) {
    if (u == null || u === '') return '—';
    const c = CURRENCIES[currency] || CURRENCIES.USD;
    const v = nsep(Math.round(u * c.rate));
    return c.after ? v + ' ' + c.sym : c.sym + v;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function plural(n, one, few, many) { n = Math.abs(n) % 100; const d = n % 10; if (n > 10 && n < 20) return many; if (d > 1 && d < 5) return few; if (d === 1) return one; return many; }
  function nsep(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function usd(n) { return (n || n === 0) ? '$' + nsep(n) : '—'; }
  function ppm(it) { return it.pricePerM2 || (it.priceUSD && it.area ? Math.round(it.priceUSD / it.area) : null); }
  function itemById(id) { return allItems.find(it => String(it.id) === String(id)); }
  function rentOf(it) { return it.rentMonthUSD || (it.priceUSD ? Math.round(it.priceUSD * 0.06 / 12) : 0); }

  function flagHTML(it, cls) {
    return it.country ? `<i class="flag flag--${esc(it.country)}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>` : '';
  }
  function ico(name) { return `<i class="ico ico--${name}" aria-hidden="true"></i>`; }
  function metaLine(it) {
    const p = [];
    if (it.location) {
      // В адресе город записан по-русски — подменяем на язык интерфейса
      const loc = it.city ? it.location.replace(it.city, cityName(it.city)) : it.location;
      p.push(`<span>${flagHTML(it, 'flag--sm')}${esc(loc)}</span>`);
    }
    if (typeof it.beds === 'number' && it.beds > 0) {
      p.push(`<span>${ico('bed')}${it.beds} ${lang === 'ru' ? plural(it.beds, 'спальня', 'спальни', 'спален') : t(it.beds === 1 ? 'd_bed' : 'd_beds', 'спальни')}</span>`);
    } else if (it.beds) {
      p.push(`<span>${ico('bed')}${/студия/i.test(it.beds) ? t('d_studio', 'Студия') : esc(it.beds)}</span>`);
    }
    if (it.baths) p.push(`<span>${ico('bath')}${it.baths} ${t('d_bath', 'с/у')}</span>`);
    if (it.area) p.push(`<span>${ico('area')}${esc(it.area)} м²</span>`);
    return p.join('');
  }
  function cardHTML(it) {
    const img = it.image || 'assets/hero-phuket.jpg';
    const tag = it.type ? `<span class="card__tag">${esc(it.type)}</span>` : '';
    const beach = it.beach ? `<p class="card__beach">${esc(it.beach)}</p>` : '';
    const per = ppm(it);
    const onCmp = compare.has(String(it.id)) ? ' is-active' : '';
    const onFav = favorites.has(String(it.id)) ? ' is-active' : '';
    const badges = [];
    // Доходность показываем только там, где аренда взята из объявления.
    // Раньше бейдж рисовался и по оценке rentOf(), из-за чего у всех объектов
    // без данных выходили одинаковые «6%» — плашка ничего не сообщала.
    if (it.rentMonthUSD) {
      const yld = grossYield(it);
      if (yld) badges.push(`<span class="badge badge--yield">${yld.toFixed(0)}% ${t('d_yieldbadge', 'доходность')}</span>`);
    }
    if (it.discountPct) badges.push(`<span class="badge badge--disc">−${it.discountPct}%</span>`);
    const oldPrice = it.oldPriceUSD ? `<s>${money(it.oldPriceUSD)}</s>` : '';
    return `<article class="card reveal" data-id="${esc(it.id)}">
      <div class="card__media">
        <img src="${esc(img)}" alt="${esc(it.title || 'Объект на Пхукете')}" loading="lazy" onerror="this.onerror=null;this.src='assets/hero-phuket.jpg'"/>
        <div class="card__badges">${tag}${badges.join('')}</div>
        <button class="card__fav${onFav}" data-action="fav" data-id="${esc(it.id)}" type="button" aria-label="В избранное" aria-pressed="${onFav ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s-7.5-4.6-10-9.2C.3 8.4 1.8 4.9 5.2 4.9c2 0 3.3 1.1 4.1 2.3.8-1.2 2.1-2.3 4.1-2.3 3.4 0 4.9 3.5 3.2 6.9C19.5 16.4 12 21 12 21z"/></svg>
        </button>
        <button class="card__compare${onCmp}" data-action="compare" data-id="${esc(it.id)}" type="button" aria-label="Добавить в сравнение" aria-pressed="${onCmp ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg><span>${t('d_compare', 'Сравнить')}</span>
        </button>
      </div>
      <div class="card__body">
        <span class="card__price">${oldPrice}${it.priceUSD ? money(it.priceUSD) : esc(it.priceLabel || t('d_price_req', 'Цена по запросу'))}</span>
        <h3>${esc(it.title || 'Объект на Пхукете')}</h3>
        <p class="card__meta">${metaLine(it)}</p>
        ${beach}
        <div class="card__bottom">
          <span class="card__ppm">${per ? `${ico('tag')}≈ ${money(per)}/м²` : ''}</span>
          ${it.url ? `<a class="card__link" href="${esc(it.url)}">${t('d_more', 'Подробнее')} <span class="card__arrow">→</span></a>` : `<button class="card__link" data-action="detail" data-id="${esc(it.id)}" type="button">${t('d_more', 'Подробнее')} <span class="card__arrow">→</span></button>`}
        </div>
      </div>
    </article>`;
  }

  function getFilters() {
    return {
      q: (fSearch && fSearch.value || '').trim().toLowerCase(),
      type: fType && fType.value || '',
      city: fCity && fCity.value || '',
      district: fDistrict && fDistrict.value || '',
      beds: fBeds && fBeds.value || '',
      area: fArea && fArea.value ? +fArea.value : 0,
      pmin: pMin ? +pMin.value : 0,
      pmax: pMax ? +pMax.value : Infinity,
      sort: fSort && fSort.value || 'default',
    };
  }
  function matches(it, f) {
    if (favOnly && !favorites.has(String(it.id))) return false;
    if (beachOnly && !it.beach) return false;
    if (f.q) { const hay = ((it.title || '') + ' ' + (it.location || '') + ' ' + (it.type || '') + ' ' + (it.city || '') + ' ' + (it.countryName || '')).toLowerCase(); if (!hay.includes(f.q)) return false; }
    if (country && it.country !== country) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.city && it.city !== f.city) return false;
    if (f.district && district(it) !== f.district) return false;
    if (f.beds) { const b = typeof it.beds === 'number' ? it.beds : 0; if (f.beds === '4') { if (b < 4) return false; } else if (String(b) !== f.beds) return false; }
    if (f.area && (!it.area || it.area < f.area)) return false;
    if (it.priceUSD) { if (it.priceUSD < f.pmin || it.priceUSD > f.pmax) return false; }
    return true;
  }
  function sortItems(arr, sort) {
    const by = {
      'price-asc': (a, b) => (a.priceUSD || 0) - (b.priceUSD || 0),
      'price-desc': (a, b) => (b.priceUSD || 0) - (a.priceUSD || 0),
      'area-desc': (a, b) => (b.area || 0) - (a.area || 0),
      'ppm-asc': (a, b) => (ppm(a) || 1e12) - (ppm(b) || 1e12),
    };
    return by[sort] ? arr.slice().sort(by[sort]) : arr;
  }
  function render(resetPage) {
    if (!grid) return;
    if (resetPage) shown = PAGE_SIZE;
    const f = getFilters();
    const list = sortItems(allItems.filter(it => matches(it, f)), f.sort);
    const page = list.slice(0, shown);
    grid.innerHTML = page.map(cardHTML).join('');
    observeReveal(Array.from(grid.querySelectorAll('.reveal')));
    markLoaded(grid);
    if (catalogCount) catalogCount.textContent = list.length ? (t('d_found', 'Найдено объектов') + ': ' + list.length + (favOnly ? ' · ' + t('d_fav', 'избранное') : '')) : '';
    if (catalogEmpty) catalogEmpty.hidden = list.length > 0;
    if (catalogMore) catalogMore.hidden = list.length <= shown;
  }

  /* ---------- ПЕРЕКЛЮЧАТЕЛЬ СТРАН ---------- */
  const geoSwitch = document.getElementById('geoSwitch');

  function countryCount(code) {
    return allItems.filter(it => !code || it.country === code).length;
  }
  function renderGeoSwitch() {
    if (!geoSwitch) return;
    geoSwitch.innerHTML = COUNTRIES
      .filter(c => !c.code || allItems.some(it => it.country === c.code))
      .map(c => `<button type="button" data-country="${c.code}"${c.code === country ? ' class="is-active"' : ''} aria-pressed="${c.code === country}">
        ${c.code ? `<i class="flag flag--${c.code}" aria-hidden="true"></i>` : ''}${esc(countryName(c.code))}
        <span class="geo-switch__count">${countryCount(c.code)}</span>
      </button>`).join('');
  }
  function fillCities() {
    if (!fCity) return;
    const cur = fCity.value;
    const cities = Array.from(new Set(allItems
      .filter(it => !country || it.country === country)
      .map(it => it.city).filter(Boolean))).sort();
    fCity.innerHTML = `<option value="">${esc(t('d_allcities', 'Все города'))}</option>` +
      cities.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(cityName(c))}</option>`).join('');
    if (cur && !cities.includes(cur)) fCity.value = '';
  }
  function fillDistricts() {
    if (!fDistrict) return;
    const cur = fDistrict.value;
    const city = fCity && fCity.value;
    const ds = Array.from(new Set(allItems
      .filter(it => (!country || it.country === country) && (!city || it.city === city))
      .map(district).filter(Boolean))).sort();
    fDistrict.innerHTML = `<option value="">${esc(t('d_alldistricts', 'Все районы'))}</option>` +
      ds.map(d => `<option value="${esc(d)}"${d === cur ? ' selected' : ''}>${esc(d)}</option>`).join('');
    if (cur && !ds.includes(cur)) fDistrict.value = '';
  }
  function setCountry(code) {
    country = code;
    try { localStorage.setItem('ae_country', code); } catch (e) {}
    renderGeoSwitch();
    fillCities();
    fillDistricts();
    initSliders();
    render(true);
    renderDistricts();
    renderSearchChips();
    refreshAllMap();
  }
  geoSwitch && geoSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('[data-country]');
    if (b) setCountry(b.dataset.country);
  });
  fCity && fCity.addEventListener('change', () => { fillDistricts(); render(true); refreshAllMap(); });

  /* ---------- СРАВНЕНИЕ ---------- */
  const compareBar = document.getElementById('compareBar');
  const compareCount = document.getElementById('compareCount');
  const compareChips = document.getElementById('compareChips');
  const compareOpen = document.getElementById('compareOpen');
  const compareClear = document.getElementById('compareClear');

  function toggleCompare(id) {
    id = String(id);
    if (compare.has(id)) compare.delete(id);
    else { if (compare.size >= MAX_COMPARE) { flashBar(); return; } compare.add(id); }
    syncCompareUI();
  }
  function flashBar() { if (!compareBar) return; compareBar.classList.add('shake'); setTimeout(() => compareBar.classList.remove('shake'), 500); }
  function toggleFav(id, btn) {
    id = String(id);
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFav();
    if (btn) { const on = favorites.has(id); btn.classList.toggle('is-active', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (favOnly) render(true);
  }
  function syncCompareUI() {
    grid && grid.querySelectorAll('.card__compare').forEach(btn => {
      const on = compare.has(String(btn.dataset.id));
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // панель сравнения перекрывает плавающие кнопки — приподнимаем их
    document.body.classList.toggle('has-compare', compare.size > 0);
    if (!compareBar) return;
    compareBar.hidden = compare.size === 0;
    if (compareCount) compareCount.textContent = compare.size;
    if (compareChips) {
      compareChips.innerHTML = Array.from(compare).map(id => {
        const it = itemById(id); if (!it) return '';
        return `<span class="compare-chip" title="${esc(it.title || '')}"><img src="${esc(it.image || 'assets/hero-phuket.jpg')}" alt=""/><button data-action="uncompare" data-id="${esc(id)}" aria-label="Убрать">×</button></span>`;
      }).join('');
    }
    if (compareOpen) compareOpen.disabled = compare.size < 2;
  }
  function openCompare() {
    if (compare.size < 2) return;
    const items = Array.from(compare).map(itemById).filter(Boolean);
    const rows = [
      [t('cmp_type', 'Тип'), it => esc(it.type || '—')],
      [t('cmp_price', 'Цена'), it => `<b>${it.priceUSD ? money(it.priceUSD) : esc(it.priceLabel || '—')}</b>`],
      [t('cmp_ppm', 'Цена за м²'), it => ppm(it) ? money(ppm(it)) : '—'],
      [t('cmp_beds', 'Спальни'), it => (it.beds != null ? esc(it.beds) : '—')],
      [t('cmp_baths', 'Санузлы'), it => (it.baths != null ? esc(it.baths) : '—')],
      [t('cmp_area', 'Площадь'), it => it.area ? esc(it.area) + ' м²' : '—'],
      [t('cmp_loc', 'Локация'), it => esc(it.location || '—')],
      [t('cmp_beach', 'У пляжа'), it => esc(it.beach || '—')],
      [t('cmp_rent', 'Аренда/мес'), it => rentOf(it) ? money(rentOf(it)) : '—'],
      [t('cmp_yield', 'Доходность, брутто'), it => { const r = rentOf(it); return (r && it.priceUSD) ? (r * 12 / it.priceUSD * 100).toFixed(1) + '%' : '—'; }],
    ];
    const head = '<th></th>' + items.map(it => `<th><div class="cmp-h"><img src="${esc(it.image || 'assets/hero-phuket.jpg')}" alt=""/><span>${esc(it.title || 'Объект')}</span></div></th>`).join('');
    const body = rows.map(([label, fn]) => `<tr><td class="cmp-label">${label}</td>${items.map(it => `<td>${fn(it)}</td>`).join('')}</tr>`).join('');
    const cta = items.map(it => `<td><button class="btn btn--gold btn--sm" data-action="detail" data-id="${esc(it.id)}" type="button">${t('cmp_open', 'Открыть')}</button></td>`).join('');
    setModal('compareBox', `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal__title">${t('cmp_title', 'Сравнение объектов')}</h3>
      <div class="cmp-scroll"><table class="cmp-table"><thead><tr>${head}</tr></thead><tbody>${body}<tr><td></td>${cta}</tr></tbody></table></div>
    `);
    openModal('compareModal');
  }

  /* ---------- КАРТОЧКА ОБЪЕКТА + КАЛЬКУЛЯТОРЫ ---------- */
  const SPEC_ICON = { 'Тип': 'home', 'Спальни': 'bed', 'Санузлы': 'bath', 'Площадь': 'area' };
  function specRow(label, val) {
    if (!val) return '';
    const name = SPEC_ICON[label];
    return `<div class="spec"><span>${name ? ico(name) : ''}${label}</span><b>${val}</b></div>`;
  }
  function calcGridHTML(price, rent, fromListing) {
    return `<div class="calc-grid">
        <div class="calc" id="calcMortgage" data-price="${price}">
          <h4>${t('c_mortgage', 'Кредитный калькулятор')}</h4>
          <label class="calc__row">${t('c_cost', 'Стоимость, $')}<input type="number" id="m_price" value="${price}" min="0" step="1000"></label>
          <label class="calc__row">${t('c_down', 'Первоначальный взнос')}: <output id="m_down_v">30%</output><input type="range" id="m_down" min="0" max="90" value="30" step="5"></label>
          <label class="calc__row">${t('c_rate', 'Ставка, % годовых')}<input type="number" id="m_rate" value="6" min="0" max="30" step="0.1"></label>
          <label class="calc__row">${t('c_term', 'Срок')}: <output id="m_term_v">20</output><input type="range" id="m_term" min="5" max="30" value="20" step="1"></label>
          <div class="calc__out">
            <div><span>${t('c_pay', 'Платёж / мес')}</span><b id="m_payment">—</b></div>
            <div><span>${t('c_loan', 'Сумма кредита')}</span><b id="m_loan">—</b></div>
            <div><span>${t('c_over', 'Переплата')}</span><b id="m_interest">—</b></div>
          </div>
          <p class="calc__note">${t('c_note_m', 'Ориентировочный расчёт аннуитетного платежа. Условия зависят от банка и статуса покупателя.')}</p>
        </div>
        <div class="calc" id="calcRoi">
          <h4>${t('c_roi', 'Калькулятор доходности')}</h4>
          <label class="calc__row">${t('c_cost', 'Стоимость, $')}<input type="number" id="r_price" value="${price}" min="0" step="1000"></label>
          <label class="calc__row">${t('c_rent', 'Аренда / мес, $')}<input type="number" id="r_rent" value="${rent}" min="0" step="50"></label>
          <label class="calc__row">${t('c_occ', 'Загрузка')}: <output id="r_occ_v">75%</output><input type="range" id="r_occ" min="30" max="100" value="75" step="5"></label>
          <div class="calc__out">
            <div><span>${t('c_income', 'Доход / год')}</span><b id="r_annual">—</b></div>
            <div><span>${t('c_yield', 'Доходность')}</span><b id="r_yield">—</b></div>
            <div><span>${t('c_payback', 'Окупаемость')}</span><b id="r_payback">—</b></div>
          </div>
          <p class="calc__note">${fromListing ? t('c_note_r1', 'Аренда взята с объявления.') : t('c_note_r2', 'Аренда оценочная (≈6% годовых).')} ${t('c_note_r3', 'Расчёт без учёта налогов и комиссий УК.')}</p>
        </div>
      </div>`;
  }
  function buildDetail(it) {
    const img = it.image || 'assets/hero-phuket.jpg';
    const per = ppm(it);
    const beds = (typeof it.beds === 'number' && it.beds > 0) ? it.beds + ' ' + plural(it.beds, 'спальня', 'спальни', 'спален') : (it.beds ? esc(it.beds) : '');
    const wa = 'https://wa.me/79124869508?text=' + encodeURIComponent('Здравствуйте! Интересует объект «' + (it.title || '') + '» с сайта Estate Art.');
    const tg = 'https://t.me/+79124869508';
    const src = (it.source_url && /^https?:/.test(it.source_url)) ? `<a class="detail__source" href="${esc(it.source_url)}" target="_blank" rel="noopener">Источник: fazwaz.ru ↗</a>` : '';
    const price = it.priceUSD || 200000;
    const rent = rentOf(it);
    return `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <div class="detail">
        <div class="detail__media"><img src="${esc(img)}" alt="${esc(it.title || '')}" onerror="this.onerror=null;this.src='assets/hero-phuket.jpg'"/>${it.type ? `<span class="card__tag">${esc(it.type)}</span>` : ''}</div>
        <div class="detail__main">
          <h3 class="detail__title">${esc(it.title || 'Объект на Пхукете')}</h3>
          <p class="detail__loc">${esc(it.location || 'Пхукет')}${it.beach ? ' · ' + esc(it.beach) : ''}</p>
          <div class="detail__price">${it.oldPriceUSD ? `<s>${money(it.oldPriceUSD)}</s> ` : ''}${it.priceUSD ? money(it.priceUSD) : esc(it.priceLabel || '')}${per ? `<small>≈ ${money(per)}/м²</small>` : ''}</div>
          <div class="detail__specs">
            ${specRow('Тип', esc(it.type || ''))}
            ${specRow('Спальни', beds)}
            ${specRow('Санузлы', it.baths != null ? it.baths : '')}
            ${specRow('Площадь', it.area ? esc(it.area) + ' м²' : '')}
          </div>
          ${it.description ? `<p class="detail__desc">${esc(it.description)}</p>` : ''}
          <div class="detail__actions">
            <a class="btn btn--wa" href="${wa}" target="_blank" rel="noopener">Узнать об объекте · WhatsApp</a>
            <a class="btn btn--tg" href="${tg}" target="_blank" rel="noopener">Telegram</a>
          </div>
          ${src}
        </div>
      </div>

      ${(it.lat && it.lng) ? `<div class="detail__mapwrap"><h4 class="detail__maptitle">Расположение на карте</h4><div class="detail__map" id="detailMap"></div></div>` : ''}

      ${calcGridHTML(price, rent, !!it.rentMonthUSD)}
    `;
  }
  function openCalculator() {
    setModal('detailBox', `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal__title">${t('c_calc_title', 'Калькуляторы покупки')}</h3>
      <p class="detail__desc">${t('c_calc_intro', 'Прикиньте ежемесячный платёж по кредиту и доходность от аренды. Значения примерные — точные условия рассчитаем индивидуально.')}</p>
      ${calcGridHTML(300000, 1500, false)}
    `);
    openModal('detailModal');
    wireCalculators();
  }
  function wireCalculators() {
    const $ = id => document.getElementById(id);
    const m_price = $('m_price'), m_down = $('m_down'), m_rate = $('m_rate'), m_term = $('m_term');
    function recalcM() {
      const price = +m_price.value || 0, downP = +m_down.value, rate = +m_rate.value, years = +m_term.value;
      $('m_down_v').textContent = downP + '%';
      $('m_term_v').textContent = years + ' ' + (lang === 'ru' ? plural(years, 'год', 'года', 'лет') : t('d_year', 'лет'));
      const loan = price * (1 - downP / 100);
      const i = rate / 100 / 12, n = years * 12;
      const pay = i > 0 ? loan * i / (1 - Math.pow(1 + i, -n)) : (n ? loan / n : 0);
      $('m_loan').textContent = usd(loan);
      $('m_payment').textContent = usd(pay);
      $('m_interest').textContent = usd(pay * n - loan);
    }
    [m_price, m_down, m_rate, m_term].forEach(el => el && el.addEventListener('input', recalcM));

    const r_price = $('r_price'), r_rent = $('r_rent'), r_occ = $('r_occ');
    function recalcR() {
      const price = +r_price.value || 0, rent = +r_rent.value || 0, occ = +r_occ.value / 100;
      $('r_occ_v').textContent = (+r_occ.value) + '%';
      const annual = rent * 12 * occ;
      $('r_annual').textContent = usd(annual);
      $('r_yield').textContent = price ? (annual / price * 100).toFixed(1) + '%' : '—';
      $('r_payback').textContent = annual ? (price / annual).toFixed(1) + ' ' + (lang === 'ru' ? plural(Math.round(price / annual), 'год', 'года', 'лет') : t('d_year', 'лет')) : '—';
    }
    [r_price, r_rent, r_occ].forEach(el => el && el.addEventListener('input', recalcR));
    // связываем цену: правка в одном поле обновляет другое
    m_price && m_price.addEventListener('input', () => { if (r_price) { r_price.value = m_price.value; recalcR(); } });
    r_price && r_price.addEventListener('input', () => { if (m_price) { m_price.value = r_price.value; recalcM(); } });
    recalcM(); recalcR();
  }
  let mapInst = null;
  function wireMap(it) {
    if (!(it.lat && it.lng) || typeof L === 'undefined') return;
    const el = document.getElementById('detailMap'); if (!el) return;
    if (mapInst) { mapInst.remove(); mapInst = null; }
    mapInst = L.map(el, { scrollWheelZoom: false }).setView([it.lat, it.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapInst);
    L.marker([it.lat, it.lng]).addTo(mapInst).bindPopup(it.title || 'Объект').openPopup();
    setTimeout(() => mapInst && mapInst.invalidateSize(), 250);
  }
  function destroyMap() { if (mapInst) { mapInst.remove(); mapInst = null; } }
  function openDetail(id) {
    const it = itemById(id); if (!it) return;
    if (it.url) { window.location.href = it.url; return; }  // отдельная SEO-страница объекта
    setModal('detailBox', buildDetail(it));
    openModal('detailModal');
    wireCalculators();
    wireMap(it);
  }

  /* ---------- УНИВЕРСАЛЬНЫЕ МОДАЛКИ ---------- */
  function setModal(boxId, html) { const b = document.getElementById(boxId); if (b) b.innerHTML = html; }
  let openModalEl = null;
  function openModal(id) {
    const m = document.getElementById(id); if (!m) return;
    m.hidden = false; m.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => m.classList.add('open'));
    document.body.style.overflow = 'hidden';
    openModalEl = m;
  }
  function closeModal(m) {
    m = m || openModalEl; if (!m) return;
    m.classList.remove('open'); m.setAttribute('aria-hidden', 'true');
    setTimeout(() => { m.hidden = true; }, 300);
    document.body.style.overflow = '';
    openModalEl = null;
    destroyMap();
  }

  /* ---------- СОБЫТИЯ ---------- */
  function cardClick(e) {
    const cmp = e.target.closest('[data-action="compare"]');
    if (cmp) { e.stopPropagation(); toggleCompare(cmp.dataset.id); return; }
    const fav = e.target.closest('[data-action="fav"]');
    if (fav) { e.stopPropagation(); toggleFav(fav.dataset.id, fav); return; }
    const det = e.target.closest('[data-action="detail"]');
    if (det) { openDetail(det.dataset.id); return; }
    const card = e.target.closest('.card');
    if (card) openDetail(card.dataset.id);
  }
  if (grid) grid.addEventListener('click', cardClick);
  function clampSliders(changed) {
    if (!pMin || !pMax) return;
    let lo = +pMin.value, hi = +pMax.value;
    if (lo > hi) { if (changed === 'min') pMax.value = lo; else pMin.value = hi; lo = +pMin.value; hi = +pMax.value; }
    if (priceLabel) priceLabel.textContent = (lo <= 0 && hi >= priceCeil) ? t('d_priceany', 'Цена: любая') : t('d_price', 'Цена') + ': ' + money(lo) + ' – ' + money(hi);
  }
  function initSliders() {
    const scope = allItems.filter(it => !country || it.country === country);
    const maxP = scope.reduce((m, it) => Math.max(m, it.priceUSD || 0), 0);
    priceCeil = Math.ceil(maxP / 50000) * 50000 || 1000000;
    if (pMin && pMax) {
      [pMin, pMax].forEach(s => { s.min = 0; s.max = priceCeil; s.step = 10000; });
      pMin.value = 0; pMax.value = priceCeil; clampSliders();
    }
  }
  [fSearch, fType, fDistrict, fBeds, fArea, fSort].forEach(el => el && el.addEventListener('input', () => { render(true); refreshAllMap(); }));
  pMin && pMin.addEventListener('input', () => { clampSliders('min'); render(true); });
  pMax && pMax.addEventListener('input', () => { clampSliders('max'); render(true); });
  fBeach && fBeach.addEventListener('click', () => {
    beachOnly = !beachOnly;
    fBeach.classList.toggle('is-active', beachOnly);
    fBeach.setAttribute('aria-pressed', beachOnly ? 'true' : 'false');
    render(true);
  });
  fFav && fFav.addEventListener('click', () => {
    favOnly = !favOnly;
    fFav.classList.toggle('is-active', favOnly);
    fFav.setAttribute('aria-pressed', favOnly ? 'true' : 'false');
    render(true);
  });
  fReset && fReset.addEventListener('click', () => {
    [fSearch, fType, fCity, fDistrict, fBeds, fArea].forEach(el => el && (el.value = ''));
    fillDistricts();
    if (fSort) fSort.value = 'default';
    if (pMin) pMin.value = 0; if (pMax) pMax.value = priceCeil; clampSliders();
    favOnly = false; beachOnly = false;
    if (fFav) { fFav.classList.remove('is-active'); fFav.setAttribute('aria-pressed', 'false'); }
    if (fBeach) { fBeach.classList.remove('is-active'); fBeach.setAttribute('aria-pressed', 'false'); }
    render(true); refreshAllMap();
  });
  catalogMore && catalogMore.addEventListener('click', () => { shown += PAGE_SIZE; render(); });
  compareOpen && compareOpen.addEventListener('click', openCompare);
  compareClear && compareClear.addEventListener('click', () => { compare.clear(); syncCompareUI(); });
  compareChips && compareChips.addEventListener('click', (e) => {
    const un = e.target.closest('[data-action="uncompare"]'); if (un) toggleCompare(un.dataset.id);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
    const det = e.target.closest('#compareBox [data-action="detail"]');
    if (det) { closeModal(); setTimeout(() => openDetail(det.dataset.id), 280); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openModalEl) closeModal(); });

  /* ---------- ПОИСК-ПАНЕЛЬ, РАЙОНЫ, ФИНАНСИРОВАНИЕ ---------- */
  function scrollToCatalog() { const c = document.getElementById('catalog'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }
  function applyDistrict(d) {
    if (fDistrict) fDistrict.value = d;
    favOnly = false; if (fFav) fFav.classList.remove('is-active');
    render(true); scrollToCatalog();
  }
  function districtStats() {
    const map = new Map();
    allItems.forEach(it => { const d = district(it); if (!d) return; if (!map.has(d)) map.set(d, { count: 0, image: it.image }); map.get(d).count++; });
    return Array.from(map.entries()).map(([name, v]) => ({ name, count: v.count, image: v.image })).sort((a, b) => b.count - a.count);
  }
  function renderDistricts() {
    const wrap = document.getElementById('districtsGrid'); if (!wrap) return;
    const ds = (districtPages && districtPages.length ? districtPages : districtStats()).slice(0, 8);
    wrap.innerHTML = ds.map(d => {
      const inner = `<img src="${esc(d.image || 'assets/hero-phuket.jpg')}" alt="${esc(d.name)}" loading="lazy" onerror="this.onerror=null;this.src='assets/hero-phuket.jpg'"/>
        <span class="dcard__name">${esc(d.name)}</span>
        <span class="dcard__count">${d.count} ${plural(d.count, 'объект', 'объекта', 'объектов')}</span>`;
      return d.url
        ? `<a class="dcard reveal" href="${esc(d.url)}">${inner}</a>`
        : `<button class="dcard reveal" data-district="${esc(d.name)}" type="button">${inner}</button>`;
    }).join('');
    observeReveal(Array.from(wrap.querySelectorAll('.reveal')));
    markLoaded(wrap);
    wrap.querySelectorAll('[data-district]').forEach(b => b.addEventListener('click', () => applyDistrict(b.dataset.district)));
  }
  function renderSearchChips() {
    const wrap = document.getElementById('searchChips'); if (!wrap) return;
    const ds = districtStats().slice(0, 5);
    wrap.innerHTML = ds.map(d => `<button class="chip" data-district="${esc(d.name)}" type="button">${esc(d.name)}</button>`).join('');
    wrap.querySelectorAll('[data-district]').forEach(b => b.addEventListener('click', () => applyDistrict(b.dataset.district)));
  }
  const searchForm = document.getElementById('searchForm');
  const heroSearch = document.getElementById('heroSearch');
  searchForm && searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (fSearch && heroSearch) fSearch.value = heroSearch.value;
    render(true); scrollToCatalog();
  });
  const openCalcBtn = document.getElementById('openCalcBtn');
  openCalcBtn && openCalcBtn.addEventListener('click', openCalculator);

  /* ---------- БОКОВОЕ МЕНЮ (DRAWER) ---------- */
  const drawer = document.getElementById('drawer');
  const burger = document.getElementById('burger');
  function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false; drawer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => drawer.classList.add('open'));
    document.body.style.overflow = 'hidden';
    if (burger) burger.setAttribute('aria-expanded', 'true');
    const first = drawer.querySelector('.drawer__close');
    if (first) setTimeout(() => first.focus(), 120);
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => { drawer.hidden = true; }, 350);
    document.body.style.overflow = '';
    if (burger) { burger.setAttribute('aria-expanded', 'false'); burger.focus({ preventScroll: true }); }
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer-open]')) { e.preventDefault(); openDrawer(); }
    if (e.target.closest('[data-drawer-close]')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer && !drawer.hidden) closeDrawer(); });

  /* ---------- ПЕРЕКЛЮЧАТЕЛЬ ВАЛЮТЫ ---------- */
  const currSwitch = document.getElementById('currSwitch');
  function setCurrency(c) {
    if (!CURRENCIES[c]) return;
    currency = c;
    try { localStorage.setItem('ae_currency', c); } catch (e) {}
    if (currSwitch) currSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.curr === c));
    if (typeof clampSliders === 'function') clampSliders();
    render();
    renderUrgent();
    refreshAllMap();
  }
  currSwitch && currSwitch.addEventListener('click', (e) => { const b = e.target.closest('[data-curr]'); if (b) setCurrency(b.dataset.curr); });

  /* ---------- ЯЗЫК ИНТЕРФЕЙСА (RU/EN/TH) ---------- */
  const I18N = {
    en: {
      nav_districts: 'Districts', nav_objects: 'Listings', nav_map: 'Map', nav_finance: 'Financing',
      nav_journal: 'Journal', nav_about: 'About Alena', nav_steps: 'Process', nav_reviews: 'Reviews', nav_contacts: 'Contacts',
      nav_relocation: 'Relocation', nav_partners: 'Partners',
      partners_eyebrow: 'Vietnam from the inside', partners_title: 'Agencies, developers and channels',
      d_allcities: 'All cities', d_alldistricts: 'All districts',
      cta_request: 'Request a call', drawer_price: 'Currency', hero_hint: 'Scroll down',
      reloc_eyebrow: 'Relocation', reloc_title: 'Free relocation consultation',
      reloc_cta: 'Send a request on the site',
      reloc_wa_vn: 'Vietnam · WhatsApp', reloc_wa_th: 'Thailand · WhatsApp',
      channels_label: 'Our channels', chan_studio: 'Our studio', chan_studio_sub: 'Websites, AI, video · @IISoSArt',
      chan_ai: 'On AI and tech', chan_ai_sub: 'Deep dives and practice · @IvanArtxJarvis',
      hero_eyebrow: 'Real estate in Phuket', hero_title: 'Your dream home <em>by the ocean</em>',
      hero_sub: 'Villas and apartments in Phuket with full personal support of your deal from A to Z.',
      hero_big2: 'Villas<br>with infinity<br>pools', hero_big3: 'Step<br>inside the dream', hero_enter: 'View listings →',
      sb_eyebrow: 'Find your property', sb_title: 'Find your home in Phuket', sb_btn: 'Search', sb_ph: 'District, type or property name…',
      trust_families: 'happy families', trust_years: 'years on the island', trust_legal: '% legal protection', trust_objects: 'verified listings',
      districts_eyebrow: 'Locations', districts_title: 'Districts of Phuket',
      catalog_eyebrow: 'Catalog', catalog_title: 'Featured listings in Thailand and Vietnam',
      urgent_eyebrow: 'Best value', urgent_title: 'Urgent sale',
      map_eyebrow: 'On the map', map_title: 'Listings on the map',
      finance_eyebrow: 'Financing', finance_title: 'Flexible ways to buy',
      whyphuket_eyebrow: 'Dream location', whyphuket_title: 'Why Phuket',
      whyus_eyebrow: 'Why us', whyus_title: 'Buying in Phuket — easy and safe',
      steps_eyebrow: 'How we work', steps_title: 'Your path to property',
      faq_eyebrow: 'Q&A', faq_title: 'Frequently asked questions',
      journal_eyebrow: 'Journal', journal_title: 'Useful guides about buying in Phuket',
      reviews_eyebrow: 'Reviews', reviews_title: 'Trusted by clients',
      about_eyebrow: 'Your personal agent', contacts_eyebrow: 'Contacts', contacts_title: 'Let’s find your home in Phuket',
      catalog_cta_btn: 'Get a selection', whyus_cta: 'Get a consultation', journal_all: 'All journal articles',
      contacts_lead: 'Leave a request — I’ll reply personally and help you take the first step to your dream property.',
      contacts_role: 'Personal agent at Estate Art', contacts_note: 'Working across Phuket · Online viewings from anywhere in the world',
      lead_submit: 'Send request via WhatsApp', lead_consent: 'I agree to the processing of personal data and accept the <a href="privacy/" target="_blank" rel="noopener">privacy policy</a>',
      lead_name_ph: 'Your name', lead_phone_ph: 'Phone or @telegram', lead_msg_ph: 'What are you looking for: area, budget, type? (optional)',
      d_found: 'Listings found', d_fav: 'favorites', d_more: 'Details', d_price_req: 'Price on request',
      d_bed: 'bedroom', d_beds: 'bedrooms', d_studio: 'Studio', d_bath: 'bath', d_priceany: 'Price: any', d_price: 'Price', d_compare: 'Compare', d_yieldbadge: 'yield', cat_search_ph: 'Search: name or district…',
      d_year: 'yr', c_calc_title: 'Purchase calculators', c_calc_intro: 'Estimate your monthly loan payment and rental yield. Figures are approximate — we calculate exact terms individually.',
      c_mortgage: 'Mortgage calculator', c_roi: 'Yield calculator', c_cost: 'Price, $', c_down: 'Down payment', c_rate: 'Rate, % p.a.', c_term: 'Term',
      c_pay: 'Payment / mo', c_loan: 'Loan amount', c_over: 'Overpay', c_rent: 'Rent / mo, $', c_occ: 'Occupancy', c_income: 'Income / yr', c_yield: 'Yield', c_payback: 'Payback',
      c_note_m: 'Indicative annuity calculation. Terms depend on the bank and buyer status.', c_note_r1: 'Rent taken from the listing.', c_note_r2: 'Rent estimated (≈6% p.a.).', c_note_r3: 'Excludes taxes and management fees.',
      cmp_title: 'Compare listings', cmp_type: 'Type', cmp_price: 'Price', cmp_ppm: 'Price per m²', cmp_beds: 'Bedrooms', cmp_baths: 'Bathrooms', cmp_area: 'Area', cmp_loc: 'Location', cmp_beach: 'Near beach', cmp_rent: 'Rent/mo', cmp_yield: 'Yield, gross', cmp_open: 'Open', cmp_inbar: 'in compare',
    },
    th: {
      nav_districts: 'ทำเล', nav_objects: 'รายการ', nav_map: 'แผนที่', nav_finance: 'การเงิน',
      nav_journal: 'บทความ', nav_about: 'เกี่ยวกับอาเลน่า', nav_steps: 'ขั้นตอน', nav_reviews: 'รีวิว', nav_contacts: 'ติดต่อ',
      nav_relocation: 'ย้ายถิ่นฐาน', nav_partners: 'พันธมิตร',
      partners_eyebrow: 'เวียดนามจากคนใน', partners_title: 'เอเจนซี ผู้พัฒนา และช่องทาง',
      d_allcities: 'ทุกเมือง', d_alldistricts: 'ทุกเขต',
      cta_request: 'ขอให้ติดต่อกลับ', drawer_price: 'สกุลเงิน', hero_hint: 'เลื่อนลง',
      reloc_eyebrow: 'ย้ายถิ่นฐาน', reloc_title: 'ปรึกษาการย้ายถิ่นฐานฟรี',
      reloc_cta: 'ส่งคำขอผ่านเว็บไซต์',
      reloc_wa_vn: 'เวียดนาม · WhatsApp', reloc_wa_th: 'ไทย · WhatsApp',
      channels_label: 'ช่องของเรา', chan_studio: 'สตูดิโอของเรา', chan_studio_sub: 'เว็บไซต์ AI วิดีโอ · @IISoSArt',
      chan_ai: 'เรื่อง AI และเทคโนโลยี', chan_ai_sub: 'บทวิเคราะห์และการใช้งานจริง · @IvanArtxJarvis',
      hero_eyebrow: 'อสังหาริมทรัพย์ในภูเก็ต', hero_title: 'บ้านในฝัน <em>ริมทะเล</em>',
      hero_sub: 'วิลล่าและคอนโดในภูเก็ต พร้อมบริการดูแลการซื้อขายแบบครบวงจร',
      hero_big2: 'วิลล่า<br>พร้อมสระว่ายน้ำ<br>อินฟินิตี้', hero_big3: 'ก้าวเข้าสู่<br>บ้านในฝัน', hero_enter: 'ดูรายการ →',
      sb_eyebrow: 'ค้นหาอสังหาฯ', sb_title: 'ค้นหาบ้านของคุณในภูเก็ต', sb_btn: 'ค้นหา', sb_ph: 'ทำเล ประเภท หรือชื่อโครงการ…',
      trust_families: 'ครอบครัวที่พึงพอใจ', trust_years: 'ปีบนเกาะ', trust_legal: '% คุ้มครองทางกฎหมาย', trust_objects: 'รายการที่ตรวจสอบแล้ว',
      districts_eyebrow: 'ทำเล', districts_title: 'ทำเลในภูเก็ต',
      catalog_eyebrow: 'แคตตาล็อก', catalog_title: 'รายการแนะนำในไทยและเวียดนาม',
      urgent_eyebrow: 'คุ้มค่า', urgent_title: 'ขายด่วน',
      map_eyebrow: 'บนแผนที่', map_title: 'รายการบนแผนที่',
      finance_eyebrow: 'การเงิน', finance_title: 'วิธีการซื้อที่ยืดหยุ่น',
      whyphuket_eyebrow: 'ทำเลในฝัน', whyphuket_title: 'ทำไมต้องภูเก็ต',
      whyus_eyebrow: 'ทำไมต้องเรา', whyus_title: 'ซื้อในภูเก็ต — ง่ายและปลอดภัย',
      steps_eyebrow: 'ขั้นตอนการทำงาน', steps_title: 'เส้นทางสู่อสังหาฯ ของคุณ',
      faq_eyebrow: 'คำถาม', faq_title: 'คำถามที่พบบ่อย',
      journal_eyebrow: 'บทความ', journal_title: 'คู่มือการซื้ออสังหาฯ ในภูเก็ต',
      reviews_eyebrow: 'รีวิว', reviews_title: 'ลูกค้าไว้วางใจเรา',
      about_eyebrow: 'ตัวแทนส่วนตัวของคุณ', contacts_eyebrow: 'ติดต่อ', contacts_title: 'มาหาบ้านของคุณในภูเก็ตกัน',
      catalog_cta_btn: 'ขอรายการที่คัดสรร', whyus_cta: 'ขอคำปรึกษา', journal_all: 'บทความทั้งหมด',
      contacts_lead: 'ฝากข้อมูลไว้ — ฉันจะตอบกลับด้วยตนเองและช่วยคุณเริ่มต้น',
      contacts_role: 'ตัวแทนส่วนตัว Estate Art', contacts_note: 'ให้บริการทั่วภูเก็ต · ชมออนไลน์ได้จากทุกที่',
      lead_submit: 'ส่งคำขอผ่าน WhatsApp', lead_consent: 'ฉันยินยอมให้ประมวลผลข้อมูลส่วนบุคคลและยอมรับ <a href="privacy/" target="_blank" rel="noopener">นโยบายความเป็นส่วนตัว</a>',
      lead_name_ph: 'ชื่อของคุณ', lead_phone_ph: 'โทรศัพท์ หรือ @telegram', lead_msg_ph: 'คุณกำลังมองหาอะไร: ทำเล งบประมาณ ประเภท? (ไม่บังคับ)',
      d_found: 'พบรายการ', d_fav: 'รายการโปรด', d_more: 'รายละเอียด', d_price_req: 'ราคาตามสอบถาม',
      d_bed: 'ห้องนอน', d_beds: 'ห้องนอน', d_studio: 'สตูดิโอ', d_bath: 'ห้องน้ำ', d_priceany: 'ราคา: ทั้งหมด', d_price: 'ราคา', d_compare: 'เทียบ', d_yieldbadge: 'ผลตอบแทน', cat_search_ph: 'ค้นหา: ชื่อ หรือทำเล…',
      d_year: 'ปี', c_calc_title: 'เครื่องคำนวณการซื้อ', c_calc_intro: 'ประเมินค่างวดสินเชื่อและผลตอบแทนค่าเช่า ตัวเลขเป็นค่าประมาณ — เงื่อนไขที่แน่นอนคำนวณเป็นรายกรณี',
      c_mortgage: 'เครื่องคำนวณสินเชื่อ', c_roi: 'เครื่องคำนวณผลตอบแทน', c_cost: 'ราคา, $', c_down: 'เงินดาวน์', c_rate: 'ดอกเบี้ย % ต่อปี', c_term: 'ระยะเวลา',
      c_pay: 'ค่างวด/เดือน', c_loan: 'ยอดสินเชื่อ', c_over: 'ดอกเบี้ยรวม', c_rent: 'ค่าเช่า/เดือน, $', c_occ: 'อัตราเข้าพัก', c_income: 'รายได้/ปี', c_yield: 'ผลตอบแทน', c_payback: 'คืนทุน',
      c_note_m: 'คำนวณแบบประมาณ เงื่อนไขขึ้นกับธนาคารและสถานะผู้ซื้อ', c_note_r1: 'ค่าเช่าจากประกาศ', c_note_r2: 'ค่าเช่าประมาณ (≈6% ต่อปี)', c_note_r3: 'ไม่รวมภาษีและค่าบริหาร',
      cmp_title: 'เปรียบเทียบรายการ', cmp_type: 'ประเภท', cmp_price: 'ราคา', cmp_ppm: 'ราคาต่อ ตร.ม.', cmp_beds: 'ห้องนอน', cmp_baths: 'ห้องน้ำ', cmp_area: 'พื้นที่', cmp_loc: 'ทำเล', cmp_beach: 'ใกล้หาด', cmp_rent: 'ค่าเช่า/เดือน', cmp_yield: 'ผลตอบแทน (ก่อนหัก)', cmp_open: 'เปิด', cmp_inbar: 'ในการเปรียบเทียบ',
    },
  };
  function t(key, ru) { return (lang !== 'ru' && I18N[lang] && I18N[lang][key] != null) ? I18N[lang][key] : ru; }
  // Глубокий словарь содержимого (ключ — нормализованный русский текст листового узла)
  const DEEP = { en: {
    'Лето круглый год': 'Year-round summer',
    'Тёплое Андаманское море, пляжи и тропическая природа 12 месяцев в году.': 'Warm Andaman Sea, beaches and tropical nature 12 months a year.',
    'Доход от аренды': 'Rental income',
    'Популярное туристическое направление — ликвидная аренда и доходность до 8–10% годовых.': 'A popular tourist destination — liquid rentals and yields up to 8–10% per year.',
    'Доступность': 'Accessibility',
    'Международный аэропорт, прямые рейсы, развитая инфраструктура и медицина.': 'International airport, direct flights, developed infrastructure and healthcare.',
    'Понятное владение': 'Clear ownership',
    'Freehold для кондо и leasehold для вилл — законные и проверенные схемы.': 'Freehold for condos and leasehold for villas — legal, proven schemes.',
    'Остров, где отдых и инвестиция — это одно и то же решение.': 'An island where a holiday and an investment are the same decision.',
    'Покажем сотни объектов, не выходя из дома': 'Explore hundreds of homes without leaving yours',
    'Подбор и просмотры онлайн': 'Online search and viewings',
    'Видео-туры и личные показы — выбирайте удобно из любой точки мира.': 'Video tours and in-person viewings — choose conveniently from anywhere.',
    'Сопровождение на каждом шаге': 'Support at every step',
    'От первого звонка до ключей: подбор, проверка, сделка, сервис после покупки.': 'From the first call to the keys: selection, due diligence, deal, after-sale service.',
    'Прозрачность и юридическая защита': 'Transparency and legal protection',
    'Проверяем застройщика и документы, объясняем каждый пункт договора.': 'We vet the developer and documents and explain every clause of the contract.',
    'Прозрачный процесс без сюрпризов — вы всегда понимаете, что происходит на каждом шаге.': 'A transparent process with no surprises — you always know what happens at each step.',
    'Знакомство': 'Introduction',
    'Обсуждаем задачи, бюджет и цели покупки на звонке. Формирую персональную подборку.': 'We discuss your goals and budget on a call. I prepare a personal selection.',
    'Просмотры': 'Viewings',
    'Онлайн-туры или личные показы на острове. Честно показываю плюсы и минусы каждого варианта.': 'Online tours or in-person viewings. I honestly show the pros and cons of each option.',
    'Проверка': 'Due diligence',
    'Юридическая чистота объекта, репутация застройщика, документы и договор под защитой юриста.': 'Legal status of the property, developer reputation, documents and contract protected by a lawyer.',
    'Сделка': 'The deal',
    'Безопасные расчёты, оформление и передача ключей. Сопровождаю до последней подписи.': 'Secure payments, paperwork and handover of keys. I support you to the final signature.',
    'После покупки': 'After purchase',
    'Помогаю с меблировкой, управлением и сдачей в аренду для дохода.': 'I help with furnishing, management and renting out for income.',
    'Юридическая проверка': 'Legal check',
    'Проверяем объект, застройщика и документы до сделки.': 'We verify the property, developer and documents before the deal.',
    'Защита сделки': 'Deal protection',
    'Договор и расчёты сопровождает юрист — без скрытых рисков.': 'A lawyer handles the contract and payments — no hidden risks.',
    'Безопасные расчёты': 'Secure payments',
    'Прозрачная схема оплаты и перевода средств.': 'A transparent payment and money-transfer scheme.',
    'Поддержка после': 'After-sale support',
    'Меблировка, управление и сдача в аренду для дохода.': 'Furnishing, management and renting out for income.',
    'Не только полная оплата — на Пхукете доступны рассрочка и поэтапные схемы. Поможем подобрать удобный вариант.': 'Not only full payment — instalments and staged plans are available in Phuket. We will help you find a convenient option.',
    'Аренда с выкупом': 'Rent-to-own',
    'Превратите аренду в собственность: платежи идут в счёт покупки, а цена фиксируется заранее.': 'Turn rent into ownership: payments count toward the purchase and the price is fixed in advance.',
    'Рассрочка от застройщика': 'Developer instalments',
    'Покупка напрямую у застройщика с гибким графиком платежей, часто без банка и процентов.': 'Buy directly from the developer with a flexible payment schedule, often without a bank or interest.',
    'Поэтапная оплата': 'Staged payment',
    'Платите частями по мере строительства — удобно для объектов на стадии возведения.': 'Pay in instalments as construction progresses — convenient for off-plan projects.',
    'Калькулятор покупки': 'Purchase calculator',
    'Рассчитайте платёж по кредиту и доходность от аренды за пару секунд.': 'Calculate your loan payment and rental yield in seconds.',
    'Открыть калькулятор': 'Open calculator',
    'Коротко о главном. Остальное — обсудим лично.': 'The essentials in short. The rest — let’s discuss in person.',
    'Может ли иностранец купить недвижимость на Пхукете?': 'Can a foreigner buy property in Phuket?',
    'Да. Квартиру в кондоминиуме иностранец может оформить в полную собственность (freehold) в рамках иностранной квоты. Виллы и дома обычно оформляют в долгосрочную аренду (leasehold) или через структуру владения. Подберём законную и безопасную схему.': 'Yes. A foreigner can own a condominium unit in full ownership (freehold) within the foreign quota. Villas and houses are usually held via long-term lease (leasehold) or an ownership structure. We will arrange a legal and safe scheme.',
    'В чём разница freehold и leasehold?': 'What is the difference between freehold and leasehold?',
    'Freehold — полная собственность (чаще для кондо). Leasehold — долгосрочная аренда земли/объекта, как правило 30 лет с возможностью продления. Для вилл leasehold — распространённая и рабочая практика.': 'Freehold is full ownership (usually for condos). Leasehold is a long-term lease of the land/property, typically 30 years with renewal. For villas, leasehold is a common and workable practice.',
    'Какие расходы и налоги при покупке?': 'What costs and taxes are involved when buying?',
    'Обычно это регистрационный сбор, гербовый сбор/налог и услуги по оформлению. Точная сумма зависит от объекта и типа сделки — рассчитаем заранее, без сюрпризов.': 'Usually a transfer fee, stamp duty/tax and processing services. The exact amount depends on the property and deal type — we calculate it in advance, no surprises.',
    'Можно ли купить удалённо?': 'Can I buy remotely?',
    'Да. Проводим онлайн-показы и видео-туры, помогаем с документами и переводом средств. Многие клиенты покупают полностью дистанционно.': 'Yes. We run online viewings and video tours and help with documents and money transfers. Many clients buy entirely remotely.',
    'Какой доход приносит аренда?': 'What income does renting bring?',
    'В зависимости от локации и объекта — ориентировочно 5–10% годовых брутто. На странице каждого объекта есть калькулятор доходности с вашими параметрами.': 'Depending on location and property — roughly 5–10% gross per year. Every listing page has a yield calculator with your parameters.',
    'Помогаете ли после покупки?': 'Do you help after the purchase?',
    'Да. Поможем с меблировкой, управляющей компанией и сдачей в аренду, чтобы недвижимость работала и приносила доход.': 'Yes. We help with furnishing, a management company and renting out, so the property works and earns.',
    'Помогаю русскоговорящим клиентам безопасно купить недвижимость на Пхукете: от первого видеозвонка до получения ключей. Знаю остров изнутри, лично проверяю каждый объект и застройщика.': 'I help clients safely buy property in Phuket: from the first video call to getting the keys. I know the island inside out and personally vet every property and developer.',
    'Личный подбор объектов под ваш запрос и бюджет': 'Personal selection of properties for your needs and budget',
    'Полная юридическая проверка и сопровождение сделки': 'Full legal due diligence and deal support',
    'Помощь с переводом средств, налогами и арендой под сдачу': 'Help with money transfers, taxes and rental income',
    'Поддержка после покупки: управление и сервис': 'After-sale support: management and service',
    'на рынке недвижимости Пхукета': 'in Phuket real estate',
    'Здесь будет фото Алены': 'Alena’s photo goes here',
    'Написать в WhatsApp': 'Message on WhatsApp',
    'Написать в Telegram': 'Message on Telegram',
    '«Купили виллу в Камале полностью удалённо и ни разу не пожалели. Алена вела нас за руку, объясняла каждый документ. Это и есть доверие.»': '“We bought a villa in Kamala fully remotely and never regretted it. Alena guided us by the hand and explained every document. That is real trust.”',
    'Москва · купили виллу': 'Moscow · bought a villa',
    '«Боялась покупать за границей, но всё прошло прозрачно. Квартира у моря уже приносит доход от аренды. Спасибо за честность!»': '“I was afraid to buy abroad, but everything was transparent. The seaside apartment already earns rental income. Thank you for your honesty!”',
    'Санкт-Петербург · квартира у моря': 'St. Petersburg · seaside apartment',
    '«Профессионал высочайшего уровня. Подобрала пентхаус мечты быстрее, чем мы ожидали, и помогла даже после сделки.»': '“A top-level professional. She found our dream penthouse faster than we expected and helped even after the deal.”',
    'Дубай · пентхаус': 'Dubai · penthouse',
    'Выберите район — покажем подходящие объекты из каталога.': 'Choose a district — we’ll show matching listings from the catalog.',
    'Проверенные виллы и квартиры в лучших локациях острова — от уютных резиденций до премиальных пентхаусов с видом на Андаманское море.': 'Vetted villas and apartments in the island’s best locations — from cozy residences to premium penthouses overlooking the Andaman Sea.',
    'Объекты со сниженной ценой. Что-то приглянулось — напишите, поможем оформить выгодно.': 'Listings with reduced prices. Like something? Message us — we’ll help you get a great deal.',
    'Нажмите на маркер, чтобы увидеть цену и открыть карточку объекта.': 'Tap a marker to see the price and open the listing.',
    'Короткие гайды, которые помогут разобраться до первого звонка.': 'Short guides to help you get oriented before the first call.',
    'Не нашли подходящий вариант? Подберём объект под ваш бюджет и задачи.': 'Didn’t find the right option? We’ll find a property for your budget and goals.',
    'Проверенные виллы и квартиры в Таиланде и Вьетнаме — Пхукет, Дананг и Нячанг. От уютных резиденций до премиальных пентхаусов у моря.': 'Vetted villas and apartments in Thailand and Vietnam — Phuket, Da Nang and Nha Trang. From cozy residences to premium seaside penthouses.',
    'Карта следует за фильтрами каталога: выберите страну или город — и она покажет только их. Нажмите на маркер, чтобы увидеть цену.': 'The map follows the catalog filters: pick a country or city and it shows only those. Tap a marker to see the price.',
    'База проверенных контактов по Дананту и Нячангу: агентства, застройщики и живые сообщества. Каждый контакт подтверждён на официальной странице компании.': 'A vetted contact base for Da Nang and Nha Trang: agencies, developers and active communities. Every contact was confirmed on the company’s own page.',
    'Разберём вашу ситуацию целиком: виза и статус, жильё, банковский счёт, школа детям, налоги. Без общих слов — по вашим вводным.': 'We go through your whole situation: visa and status, housing, a bank account, schools for the kids, taxes. No generic advice — only your case.',
    'По вашему запросу ничего не найдено. Попробуйте смягчить фильтры или напишите нам — подберём вручную.': 'Nothing found for your query. Try relaxing the filters or message us — we’ll find it manually.',
    'Все типы': 'All types', 'Все районы': 'All districts', 'Спальни: любые': 'Bedrooms: any',
    '1 спальня': '1 bedroom', '2 спальни': '2 bedrooms', '3 спальни': '3 bedrooms', '4+ спальни': '4+ bedrooms',
    'Площадь: любая': 'Area: any', 'от 50 м²': 'from 50 m²', 'от 100 м²': 'from 100 m²', 'от 150 м²': 'from 150 m²', 'от 250 м²': 'from 250 m²',
    'Сортировка': 'Sort', 'Цена ↑': 'Price ↑', 'Цена ↓': 'Price ↓', 'Площадь ↓': 'Area ↓', '$ за м² ↑': '$ per m² ↑',
    '🏖 У пляжа': '🏖 Near beach', '♥ Избранное': '♥ Favorites', 'Сбросить': 'Reset', 'Показать ещё': 'Show more',
  }, th: {
    'Лето круглый год': 'ฤดูร้อนตลอดทั้งปี',
    'Тёплое Андаманское море, пляжи и тропическая природа 12 месяцев в году.': 'ทะเลอันดามันอันอบอุ่น ชายหาด และธรรมชาติเขตร้อนตลอด 12 เดือน',
    'Доход от аренды': 'รายได้จากค่าเช่า',
    'Популярное туристическое направление — ликвидная аренда и доходность до 8–10% годовых.': 'จุดหมายปลายทางยอดนิยม — ปล่อยเช่าง่าย ผลตอบแทนสูงถึง 8–10% ต่อปี',
    'Доступность': 'การเดินทางสะดวก',
    'Международный аэропорт, прямые рейсы, развитая инфраструктура и медицина.': 'สนามบินนานาชาติ เที่ยวบินตรง โครงสร้างพื้นฐานและการแพทย์ที่พร้อม',
    'Понятное владение': 'การถือครองที่ชัดเจน',
    'Freehold для кондо и leasehold для вилл — законные и проверенные схемы.': 'Freehold สำหรับคอนโดและ leasehold สำหรับวิลล่า — ถูกกฎหมายและผ่านการตรวจสอบ',
    'Остров, где отдых и инвестиция — это одно и то же решение.': 'เกาะที่การพักผ่อนและการลงทุนคือการตัดสินใจเดียวกัน',
    'Покажем сотни объектов, не выходя из дома': 'ชมอสังหาฯ นับร้อยได้โดยไม่ต้องออกจากบ้าน',
    'Подбор и просмотры онлайн': 'ค้นหาและชมออนไลน์',
    'Видео-туры и личные показы — выбирайте удобно из любой точки мира.': 'ทัวร์วิดีโอและชมจริง — เลือกได้สะดวกจากทุกที่ทั่วโลก',
    'Сопровождение на каждом шаге': 'ดูแลทุกขั้นตอน',
    'От первого звонка до ключей: подбор, проверка, сделка, сервис после покупки.': 'ตั้งแต่โทรครั้งแรกจนรับกุญแจ: คัดเลือก ตรวจสอบ ทำสัญญา และบริการหลังการขาย',
    'Прозрачность и юридическая защита': 'ความโปร่งใสและการคุ้มครองทางกฎหมาย',
    'Проверяем застройщика и документы, объясняем каждый пункт договора.': 'ตรวจสอบผู้พัฒนาและเอกสาร อธิบายทุกข้อในสัญญา',
    'Прозрачный процесс без сюрпризов — вы всегда понимаете, что происходит на каждом шаге.': 'กระบวนการโปร่งใส ไม่มีเซอร์ไพรส์ — คุณเข้าใจทุกขั้นตอนเสมอ',
    'Знакомство': 'ทำความรู้จัก',
    'Обсуждаем задачи, бюджет и цели покупки на звонке. Формирую персональную подборку.': 'พูดคุยเป้าหมายและงบประมาณทางโทรศัพท์ แล้วจัดรายการที่เหมาะกับคุณ',
    'Просмотры': 'การเข้าชม',
    'Онлайн-туры или личные показы на острове. Честно показываю плюсы и минусы каждого варианта.': 'ทัวร์ออนไลน์หรือชมจริงบนเกาะ บอกข้อดีข้อเสียอย่างตรงไปตรงมา',
    'Проверка': 'การตรวจสอบ',
    'Юридическая чистота объекта, репутация застройщика, документы и договор под защитой юриста.': 'สถานะทางกฎหมาย ชื่อเสียงผู้พัฒนา เอกสารและสัญญาภายใต้การดูแลของทนาย',
    'Сделка': 'การทำสัญญา',
    'Безопасные расчёты, оформление и передача ключей. Сопровождаю до последней подписи.': 'การชำระเงินที่ปลอดภัย จัดการเอกสารและส่งมอบกุญแจ ดูแลจนลายเซ็นสุดท้าย',
    'После покупки': 'หลังการซื้อ',
    'Помогаю с меблировкой, управлением и сдачей в аренду для дохода.': 'ช่วยเรื่องเฟอร์นิเจอร์ การบริหาร และปล่อยเช่าเพื่อสร้างรายได้',
    'Юридическая проверка': 'ตรวจสอบทางกฎหมาย',
    'Проверяем объект, застройщика и документы до сделки.': 'ตรวจสอบทรัพย์ ผู้พัฒนา และเอกสารก่อนทำสัญญา',
    'Защита сделки': 'คุ้มครองการทำสัญญา',
    'Договор и расчёты сопровождает юрист — без скрытых рисков.': 'ทนายดูแลสัญญาและการชำระเงิน — ไม่มีความเสี่ยงแอบแฝง',
    'Безопасные расчёты': 'ชำระเงินปลอดภัย',
    'Прозрачная схема оплаты и перевода средств.': 'รูปแบบการชำระและโอนเงินที่โปร่งใส',
    'Поддержка после': 'ดูแลหลังการขาย',
    'Меблировка, управление и сдача в аренду для дохода.': 'เฟอร์นิเจอร์ การบริหาร และปล่อยเช่าเพื่อรายได้',
    'Не только полная оплата — на Пхукете доступны рассрочка и поэтапные схемы. Поможем подобрать удобный вариант.': 'ไม่ใช่แค่จ่ายเต็ม — ภูเก็ตมีผ่อนชำระและแบบเป็นงวด เราช่วยเลือกแบบที่สะดวก',
    'Аренда с выкупом': 'เช่าพร้อมสิทธิ์ซื้อ',
    'Превратите аренду в собственность: платежи идут в счёт покупки, а цена фиксируется заранее.': 'เปลี่ยนค่าเช่าเป็นกรรมสิทธิ์: เงินงวดนับเป็นค่าซื้อ และล็อกราคาไว้ล่วงหน้า',
    'Рассрочка от застройщика': 'ผ่อนกับผู้พัฒนา',
    'Покупка напрямую у застройщика с гибким графиком платежей, часто без банка и процентов.': 'ซื้อตรงจากผู้พัฒนา ผ่อนยืดหยุ่น มักไม่ผ่านธนาคารและไม่มีดอกเบี้ย',
    'Поэтапная оплата': 'ชำระเป็นงวด',
    'Платите частями по мере строительства — удобно для объектов на стадии возведения.': 'จ่ายตามความคืบหน้าการก่อสร้าง — เหมาะกับโครงการที่กำลังสร้าง',
    'Калькулятор покупки': 'เครื่องคำนวณการซื้อ',
    'Рассчитайте платёж по кредиту и доходность от аренды за пару секунд.': 'คำนวณค่างวดสินเชื่อและผลตอบแทนค่าเช่าได้ในไม่กี่วินาที',
    'Открыть калькулятор': 'เปิดเครื่องคำนวณ',
    'Коротко о главном. Остальное — обсудим лично.': 'สรุปสั้น ๆ ส่วนที่เหลือคุยกันส่วนตัว',
    'Может ли иностранец купить недвижимость на Пхукете?': 'ชาวต่างชาติซื้ออสังหาฯ ในภูเก็ตได้ไหม?',
    'Да. Квартиру в кондоминиуме иностранец может оформить в полную собственность (freehold) в рамках иностранной квоты. Виллы и дома обычно оформляют в долгосрочную аренду (leasehold) или через структуру владения. Подберём законную и безопасную схему.': 'ได้ ชาวต่างชาติถือครองคอนโดแบบ freehold ได้ภายในโควตาต่างชาติ ส่วนวิลล่าและบ้านมักทำเป็นสัญญาเช่าระยะยาว (leasehold) หรือผ่านโครงสร้างการถือครอง เราจะจัดรูปแบบที่ถูกกฎหมายและปลอดภัย',
    'В чём разница freehold и leasehold?': 'freehold กับ leasehold ต่างกันอย่างไร?',
    'Freehold — полная собственность (чаще для кондо). Leasehold — долгосрочная аренда земли/объекта, как правило 30 лет с возможностью продления. Для вилл leasehold — распространённая и рабочая практика.': 'Freehold คือกรรมสิทธิ์เต็ม (มักเป็นคอนโด) ส่วน leasehold คือเช่าระยะยาว ปกติ 30 ปี ต่ออายุได้ สำหรับวิลล่า leasehold เป็นแนวทางที่ใช้กันทั่วไป',
    'Какие расходы и налоги при покупке?': 'มีค่าใช้จ่ายและภาษีอะไรบ้างตอนซื้อ?',
    'Обычно это регистрационный сбор, гербовый сбор/налог и услуги по оформлению. Точная сумма зависит от объекта и типа сделки — рассчитаем заранее, без сюрпризов.': 'โดยทั่วไปมีค่าธรรมเนียมโอน อากรแสตมป์/ภาษี และค่าดำเนินการ ยอดที่แน่นอนขึ้นกับทรัพย์และประเภทธุรกรรม — เราคำนวณให้ล่วงหน้า ไม่มีเซอร์ไพรส์',
    'Можно ли купить удалённо?': 'ซื้อแบบทางไกลได้ไหม?',
    'Да. Проводим онлайн-показы и видео-туры, помогаем с документами и переводом средств. Многие клиенты покупают полностью дистанционно.': 'ได้ เราจัดชมออนไลน์และทัวร์วิดีโอ ช่วยเรื่องเอกสารและการโอนเงิน ลูกค้าหลายรายซื้อทางไกลทั้งหมด',
    'Какой доход приносит аренда?': 'ค่าเช่าให้ผลตอบแทนเท่าไร?',
    'В зависимости от локации и объекта — ориентировочно 5–10% годовых брутто. На странице каждого объекта есть калькулятор доходности с вашими параметрами.': 'ขึ้นกับทำเลและทรัพย์ — ราว 5–10% ต่อปี (ก่อนหักค่าใช้จ่าย) แต่ละรายการมีเครื่องคำนวณผลตอบแทนตามค่าของคุณ',
    'Помогаете ли после покупки?': 'มีบริการหลังการซื้อไหม?',
    'Да. Поможем с меблировкой, управляющей компанией и сдачей в аренду, чтобы недвижимость работала и приносила доход.': 'มี เราช่วยเรื่องเฟอร์นิเจอร์ บริษัทบริหาร และปล่อยเช่า เพื่อให้ทรัพย์สร้างรายได้',
    'Помогаю русскоговорящим клиентам безопасно купить недвижимость на Пхукете: от первого видеозвонка до получения ключей. Знаю остров изнутри, лично проверяю каждый объект и застройщика.': 'ช่วยลูกค้าซื้ออสังหาฯ ในภูเก็ตอย่างปลอดภัย ตั้งแต่วิดีโอคอลครั้งแรกจนรับกุญแจ รู้จักเกาะอย่างลึกซึ้ง และตรวจสอบทุกทรัพย์และผู้พัฒนาด้วยตนเอง',
    'Личный подбор объектов под ваш запрос и бюджет': 'คัดเลือกทรัพย์ส่วนตัวตามความต้องการและงบของคุณ',
    'Полная юридическая проверка и сопровождение сделки': 'ตรวจสอบทางกฎหมายครบถ้วนและดูแลการทำสัญญา',
    'Помощь с переводом средств, налогами и арендой под сдачу': 'ช่วยเรื่องการโอนเงิน ภาษี และการปล่อยเช่า',
    'Поддержка после покупки: управление и сервис': 'ดูแลหลังการซื้อ: บริหารและบริการ',
    'на рынке недвижимости Пхукета': 'ในวงการอสังหาฯ ภูเก็ต',
    'Здесь будет фото Алены': 'รูปของอาเลน่าจะอยู่ที่นี่',
    'Написать в WhatsApp': 'แชทผ่าน WhatsApp',
    'Написать в Telegram': 'แชทผ่าน Telegram',
    '«Купили виллу в Камале полностью удалённо и ни разу не пожалели. Алена вела нас за руку, объясняла каждый документ. Это и есть доверие.»': '“ซื้อวิลล่าที่กมลาแบบทางไกลทั้งหมด ไม่เคยเสียใจเลย อาเลน่าดูแลทุกขั้นตอนและอธิบายทุกเอกสาร นี่แหละความไว้วางใจ”',
    'Москва · купили виллу': 'มอสโก · ซื้อวิลล่า',
    '«Боялась покупать за границей, но всё прошло прозрачно. Квартира у моря уже приносит доход от аренды. Спасибо за честность!»': '“กลัวการซื้อในต่างประเทศ แต่ทุกอย่างโปร่งใส คอนโดริมทะเลสร้างรายได้ค่าเช่าแล้ว ขอบคุณในความจริงใจ!”',
    'Санкт-Петербург · квартира у моря': 'เซนต์ปีเตอร์สเบิร์ก · คอนโดริมทะเล',
    '«Профессионал высочайшего уровня. Подобрала пентхаус мечты быстрее, чем мы ожидали, и помогла даже после сделки.»': '“มืออาชีพระดับสูง หาเพนต์เฮาส์ในฝันได้เร็วกว่าที่คิด และช่วยแม้หลังปิดการขาย”',
    'Дубай · пентхаус': 'ดูไบ · เพนต์เฮาส์',
    'Выберите район — покажем подходящие объекты из каталога.': 'เลือกทำเล — เราจะแสดงรายการที่ตรงจากแคตตาล็อก',
    'Проверенные виллы и квартиры в лучших локациях острова — от уютных резиденций до премиальных пентхаусов с видом на Андаманское море.': 'วิลล่าและคอนโดที่ผ่านการตรวจสอบในทำเลที่ดีที่สุดของเกาะ — ตั้งแต่เรสซิเดนซ์อบอุ่นถึงเพนต์เฮาส์หรูวิวทะเลอันดามัน',
    'Объекты со сниженной ценой. Что-то приглянулось — напишите, поможем оформить выгодно.': 'รายการลดราคา ถูกใจรายการไหน ทักมาได้เลย เราช่วยให้ได้ดีล',
    'Нажмите на маркер, чтобы увидеть цену и открыть карточку объекта.': 'แตะหมุดเพื่อดูราคาและเปิดรายละเอียดทรัพย์',
    'Короткие гайды, которые помогут разобраться до первого звонка.': 'คู่มือสั้น ๆ ช่วยให้เข้าใจก่อนโทรครั้งแรก',
    'Не нашли подходящий вариант? Подберём объект под ваш бюджет и задачи.': 'ยังไม่เจอที่ใช่? เราจะหาทรัพย์ให้ตรงงบและความต้องการของคุณ',
    'Проверенные виллы и квартиры в Таиланде и Вьетнаме — Пхукет, Дананг и Нячанг. От уютных резиденций до премиальных пентхаусов у моря.': 'วิลล่าและคอนโดที่ผ่านการตรวจสอบในไทยและเวียดนาม — ภูเก็ต ดานัง และญาจาง ตั้งแต่เรสซิเดนซ์อบอุ่นถึงเพนต์เฮาส์หรูริมทะเล',
    'Карта следует за фильтрами каталога: выберите страну или город — и она покажет только их. Нажмите на маркер, чтобы увидеть цену.': 'แผนที่ทำงานตามตัวกรองแคตตาล็อก: เลือกประเทศหรือเมือง แล้วแผนที่จะแสดงเฉพาะที่เลือก แตะหมุดเพื่อดูราคา',
    'База проверенных контактов по Дананту и Нячангу: агентства, застройщики и живые сообщества. Каждый контакт подтверждён на официальной странице компании.': 'ฐานข้อมูลผู้ติดต่อที่ตรวจสอบแล้วสำหรับดานังและญาจาง: เอเจนซี ผู้พัฒนา และชุมชนที่ใช้งานจริง ทุกรายการยืนยันจากหน้าเว็บทางการของบริษัท',
    'Разберём вашу ситуацию целиком: виза и статус, жильё, банковский счёт, школа детям, налоги. Без общих слов — по вашим вводным.': 'เราดูสถานการณ์ของคุณทั้งหมด: วีซ่าและสถานะ ที่พัก บัญชีธนาคาร โรงเรียนของลูก และภาษี — ตามเคสของคุณจริง ๆ',
    'По вашему запросу ничего не найдено. Попробуйте смягчить фильтры или напишите нам — подберём вручную.': 'ไม่พบผลลัพธ์ ลองผ่อนตัวกรองหรือทักมาหาเรา — เราจะช่วยหาด้วยตนเอง',
    'Все типы': 'ทุกประเภท', 'Все районы': 'ทุกทำเล', 'Спальни: любые': 'ห้องนอน: ทั้งหมด',
    '1 спальня': '1 ห้องนอน', '2 спальни': '2 ห้องนอน', '3 спальни': '3 ห้องนอน', '4+ спальни': '4+ ห้องนอน',
    'Площадь: любая': 'พื้นที่: ทั้งหมด', 'от 50 м²': 'ตั้งแต่ 50 ตร.ม.', 'от 100 м²': 'ตั้งแต่ 100 ตร.ม.', 'от 150 м²': 'ตั้งแต่ 150 ตร.ม.', 'от 250 м²': 'ตั้งแต่ 250 ตร.ม.',
    'Сортировка': 'จัดเรียง', 'Цена ↑': 'ราคา ↑', 'Цена ↓': 'ราคา ↓', 'Площадь ↓': 'พื้นที่ ↓', '$ за м² ↑': '$ ต่อ ตร.ม. ↑',
    '🏖 У пляжа': '🏖 ใกล้หาด', '♥ Избранное': '♥ รายการโปรด', 'Сбросить': 'ล้างค่า', 'Показать ещё': 'แสดงเพิ่ม',
  } };
  const DEEP_SEL = 'h1,h2,h3,h4,p,li,summary,b,span,a,button,option,output';
  const DEEP_EXCL = '#catalogGrid,#urgentGrid,#districtsGrid,#searchChips,#mapAll,.compare-bar,.modal,script,style,noscript';
  function deepTranslate(l) {
    document.querySelectorAll(DEEP_SEL).forEach(el => {
      if (el.children.length) return;
      if (el.hasAttribute('data-i18n') || el.hasAttribute('data-count')) return;
      if (el.closest(DEEP_EXCL)) return;
      if (el.id === 'catalogCount' || el.id === 'priceLabel' || el.id === 'catalogUpdated') return; // \u0442\u0435\u043a\u0441\u0442 \u0441\u0442\u0430\u0432\u0438\u0442 JS
      if (el.dataset.dru == null) el.dataset.dru = el.textContent;
      if (!el.dataset.dru.trim()) return;
      const key = el.dataset.dru.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const tr = (l !== 'ru' && DEEP[l]) ? DEEP[l][key] : null;
      el.textContent = (tr != null) ? tr : el.dataset.dru;
    });
  }

  let lang = 'ru';
  try { const l = localStorage.getItem('ae_lang'); if (l === 'en' || l === 'th' || l === 'ru') lang = l; } catch (e) {}
  const langSwitch = document.getElementById('langSwitch');
  function applyLang(l) {
    lang = l;
    try { localStorage.setItem('ae_lang', l); } catch (e) {}
    document.documentElement.lang = l;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (el.dataset.ru == null) el.dataset.ru = el.innerHTML;
      const tr = (l !== 'ru' && I18N[l]) ? I18N[l][k] : null;
      el.innerHTML = (tr != null) ? tr : el.dataset.ru;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const k = el.getAttribute('data-i18n-ph');
      if (el.dataset.phru == null) el.dataset.phru = el.getAttribute('placeholder') || '';
      const tr = (l !== 'ru' && I18N[l]) ? I18N[l][k] : null;
      el.setAttribute('placeholder', (tr != null) ? tr : el.dataset.phru);
    });
    if (langSwitch) langSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.lang === l));
    deepTranslate(l);
    if (allItems.length) {
      renderGeoSwitch(); fillCities(); fillDistricts();
      render(); renderUrgent();
      if (typeof clampSliders === 'function') clampSliders();
    }
  }
  langSwitch && langSwitch.addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b) applyLang(b.dataset.lang); });
  applyLang(lang);

  /* ---------- СРОЧНАЯ ПРОДАЖА (объекты со скидкой) ---------- */
  const urgentGrid = document.getElementById('urgentGrid');
  const urgentSection = document.getElementById('urgent');
  if (urgentGrid) urgentGrid.addEventListener('click', cardClick);
  function renderUrgent() {
    if (!urgentGrid) return;
    const list = allItems.filter(it => it.discountPct).sort((a, b) => (b.discountPct || 0) - (a.discountPct || 0)).slice(0, 6);
    if (!list.length) { if (urgentSection) urgentSection.hidden = true; return; }
    if (urgentSection) urgentSection.hidden = false;
    urgentGrid.innerHTML = list.map(cardHTML).join('');
    observeReveal(Array.from(urgentGrid.querySelectorAll('.reveal')));
    markLoaded(urgentGrid);
  }

  /* ---------- КАРТА ВСЕХ ОБЪЕКТОВ ---------- */
  let allMap = null, clusterGroup = null;
  function refreshAllMap() {
    if (typeof L === 'undefined') return;
    const el = document.getElementById('mapAll'); if (!el) return;
    // Карта показывает ровно то же, что каталог: иначе при выборе Вьетнама
    // она продолжала бы показывать Пхукет и сбивала бы с толку.
    const f = getFilters();
    const pts = allItems.filter(it => it.lat && it.lng && matches(it, f));
    if (!pts.length) return;
    if (!allMap) {
      allMap = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(allMap);
    }
    if (clusterGroup) clusterGroup.clearLayers();
    else { clusterGroup = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 50, showCoverageOnHover: false }) : L.layerGroup()); allMap.addLayer(clusterGroup); }
    const group = [];
    pts.forEach(it => {
      const m = L.marker([it.lat, it.lng]);
      m.bindPopup(`<div class="mappopup"><b>${esc(it.title || 'Объект')}</b><span>${money(it.priceUSD)}</span><button data-action="detail" data-id="${esc(it.id)}" type="button">Подробнее</button></div>`);
      clusterGroup.addLayer(m); group.push([it.lat, it.lng]);
    });
    allMap.fitBounds(group, { padding: [40, 40], maxZoom: 13 });
    setTimeout(() => allMap && allMap.invalidateSize(), 200);
  }
  // клик «Подробнее» внутри попапа карты
  document.addEventListener('click', (e) => {
    const d = e.target.closest('#mapAll [data-action="detail"]');
    if (d) openDetail(d.dataset.id);
  });

  /* ---------- ИНИЦИАЛИЗАЦИЯ КАТАЛОГА ---------- */
  function initCatalog(data) {
    const items = (data && data.items && data.items.length) ? data.items : FALLBACK_CATALOG.items;
    allItems = items.filter(it => !it.hidden).map((it, i) => Object.assign({}, it, { id: it.id != null ? String(it.id) : 'demo' + i }));
    districtPages = (data && data.districts && data.districts.length) ? data.districts : null;
    // типы для фильтра
    if (fType) {
      const types = Array.from(new Set(allItems.map(it => it.type).filter(Boolean))).sort();
      fType.insertAdjacentHTML('beforeend', types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join(''));
    }
    renderGeoSwitch();
    fillCities();
    fillDistricts();
    // активная валюта в переключателе
    if (currSwitch) currSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.curr === currency));
    initSliders();
    render(true);
    renderDistricts();
    renderSearchChips();
    renderUrgent();
    refreshAllMap();
    if (typeof renderMarquee === 'function') renderMarquee();
    const upd = document.getElementById('catalogUpdated');
    if (upd && data && data.updated) upd.textContent = 'Каталог обновлён ' + data.updated + ' · источник: ' + (data.source || '—');
  }
  if (grid) {
    // Скелетоны на время загрузки: иначе главная секция сайта стоит пустой
    grid.innerHTML = '<article class="card card--skeleton"></article>'.repeat(PAGE_SIZE);
    const src = grid.getAttribute('data-src') || 'data/catalog.json';
    fetch(src, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(initCatalog)
      .catch(() => initCatalog(FALLBACK_CATALOG));
  }

  /* ---------- ФОРМА ЗАЯВКИ → WhatsApp ---------- */
  const leadForm = document.getElementById('leadForm');
  if (leadForm) {
    const nameEl = document.getElementById('leadName');
    const phoneEl = document.getElementById('leadPhone');
    const msgEl = document.getElementById('leadMsg');
    const consentEl = document.getElementById('leadConsent');
    const hintEl = document.getElementById('leadHint');
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      let ok = true;
      [nameEl, phoneEl].forEach(el => { const bad = !el.value.trim(); el.classList.toggle('err', bad); if (bad) ok = false; });
      if (!ok) { if (hintEl) hintEl.textContent = 'Укажите имя и контакт — и я свяжусь с вами.'; return; }
      if (consentEl && !consentEl.checked) {
        const c = consentEl.closest('.lead__consent'); if (c) c.classList.add('err');
        if (hintEl) hintEl.textContent = 'Отметьте согласие на обработку персональных данных.';
        return;
      }
      const text = 'Заявка с сайта Estate Art\nИмя: ' + nameEl.value.trim() +
        '\nКонтакт: ' + phoneEl.value.trim() +
        (msgEl && msgEl.value.trim() ? '\nЗапрос: ' + msgEl.value.trim() : '');
      if (hintEl) hintEl.textContent = 'Открываем WhatsApp с вашей заявкой…';
      window.open('https://wa.me/79124869508?text=' + encodeURIComponent(text), '_blank', 'noopener');
    });
    [nameEl, phoneEl].forEach(el => el && el.addEventListener('input', () => el.classList.remove('err')));
    consentEl && consentEl.addEventListener('change', () => { const c = consentEl.closest('.lead__consent'); if (c) c.classList.remove('err'); });
  }

  /* ======================================================================
     ПАРТНЁРЫ И КАНАЛЫ ВЬЕТНАМА + ОТКРЫТИЕ КОНТАКТОВ ПО РЕГИСТРАЦИИ

     Важно про «закрытость»: это сбор заявок, а не защита. Контакты вынесены
     в отдельный data/contacts.json, который подгружается только после
     регистрации, — их нет в разметке страницы и их не индексируют поисковики.
     Но файл лежит в открытом доступе по прямой ссылке. Чтобы контакты были
     закрыты по-настоящему, их надо отдавать с сервера по токену.
     ====================================================================== */
  const partnersGrid = document.getElementById('partnersGrid');
  const partnersCommunities = document.getElementById('partnersCommunities');
  const marquee = document.getElementById('devMarquee');
  const marqueeNote = document.getElementById('marqueeNote');
  const partnersLegal = document.getElementById('partnersLegal');
  const regState = document.getElementById('regState');

  const REG_KEY = 'ae_reg';
  let channels = null;
  let contacts = null;

  function regInfo() {
    try { return JSON.parse(localStorage.getItem(REG_KEY) || 'null'); } catch (e) { return null; }
  }
  function isRegistered() { return !!(regInfo() && regInfo().name); }

  const ICON_LOCK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const ICON_TG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';

  const KIND_LABEL = { agency: 'Агентство', developer: 'Застройщик' };
  const FOCUS_LABEL = { sale: 'продажа', rent: 'аренда', both: 'продажа и аренда', developer: 'свои проекты' };

  function telHref(v) { return 'tel:' + String(v).replace(/[^\d+]/g, ''); }
  function tgHref(v) {
    const h = String(v).trim();
    if (/^https?:/.test(h)) return h;
    return 'https://t.me/' + h.replace(/^@/, '').replace(/^t\.me\//, '');
  }
  function zaloHref(v) {
    const h = String(v).trim();
    if (/^https?:/.test(h)) return h;
    const digits = h.replace(/[^\d]/g, '');
    return digits ? 'https://zalo.me/' + digits : h;
  }
  function shortLabel(v) { return String(v).replace(/^https?:\/\//, '').replace(/^(t\.me|zalo\.me)\//, '@').slice(0, 34); }

  function contactsHTML(id) {
    const c = contacts && contacts[id];
    if (!c) return '<ul class="contacts-list"><li><span class="hint">Контакты уточняются</span></li></ul>';
    const rows = [];
    if (c.phone) rows.push(`<li><span>Телефон</span><a href="${esc(telHref(c.phone))}">${esc(c.phone)}</a></li>`);
    if (c.telegram) rows.push(`<li><span>Telegram</span><a href="${esc(tgHref(c.telegram))}" target="_blank" rel="noopener">${esc(shortLabel(c.telegram))}</a></li>`);
    if (c.zalo) rows.push(`<li><span>Zalo</span><a href="${esc(zaloHref(c.zalo))}" target="_blank" rel="noopener">${esc(shortLabel(c.zalo))}</a></li>`);
    if (c.verifiedAt) rows.push(`<li><span>Проверено</span><b class="hint">${esc(c.verifiedAt)}</b></li>`);
    return `<ul class="contacts-list">${rows.join('')}</ul>`;
  }

  function lockHTML(company) {
    const what = (company.channels || []).map(k => ({ phone: 'телефон', telegram: 'Telegram', zalo: 'Zalo' })[k]).filter(Boolean);
    return `<div class="lock">
      <span class="lock__head">${ICON_LOCK} Контакты закрыты</span>
      <p class="lock__note">${what.length ? esc(what.join(', ')) : 'Контакты'} — откроются бесплатно после короткой регистрации.</p>
      <button class="btn btn--gold" type="button" data-open-reg>Открыть контакты</button>
    </div>`;
  }

  function companyCard(c) {
    const kind = KIND_LABEL[c.kind] || c.kind;
    const kindIco = ico(c.kind === 'developer' ? 'developer' : 'agency');
    const focus = FOCUS_LABEL[c.focus] || '';
    return `<article class="pcard">
      <div class="pcard__top">
        <h3>${esc(c.name)}</h3>
        <span class="pcard__kind">${kindIco}${esc(kind)}</span>
      </div>
      <p class="pcard__meta">
        <i class="flag flag--${esc(c.country || 'vn')} flag--sm" aria-hidden="true"></i>
        ${esc(c.city)}${focus ? ' · ' + esc(focus) : ''}${c.languages ? ' · ' + esc(c.languages) : ''}
      </p>
      <p class="pcard__note">${esc(c.note || '')}</p>
      ${isRegistered() ? contactsHTML(c.id) : lockHTML(c)}
    </article>`;
  }

  function communityCard(c) {
    const n = c.members ? c.members.toLocaleString('ru-RU') + ' участников' : 'Telegram';
    return `<article class="pcard pcard--community">
      <div class="pcard__top">
        <h3>${esc(c.name)}</h3>
        <span class="pcard__kind">${ico('community')}Сообщество</span>
      </div>
      <p class="pcard__meta">${esc(c.city)} · ${esc(n)}</p>
      <p class="pcard__note">${esc((c.note || '').slice(0, 170))}</p>
      <a class="pcard__link" href="${esc(c.url)}" target="_blank" rel="noopener">${ICON_TG} Открыть канал →</a>
    </article>`;
  }

  function renderPartners() {
    if (!partnersGrid || !channels) return;
    const byCity = channels.companies.slice().sort((a, b) =>
      (a.city || '').localeCompare(b.city || '', 'ru') || (a.name || '').localeCompare(b.name || '', 'ru'));
    partnersGrid.innerHTML = byCity.map(companyCard).join('');

    if (partnersCommunities) {
      partnersCommunities.innerHTML = channels.communities.length
        ? `<span class="partners__label">Живые сообщества во Вьетнаме</span>
           <div class="partners__grid">${channels.communities.map(communityCard).join('')}</div>`
        : '';
    }
    if (partnersLegal) {
      partnersLegal.textContent =
        'Контакты собраны из открытых источников и подтверждены на официальных страницах компаний ' +
        (channels.verifiedAt || '') + '. Сообщества — открытые Telegram-каналы: мы их не ведём и за содержание ' +
        'не отвечаем. Мессенджер-контакты устаревают — если номер не отвечает, напишите нам.';
    }
    renderRegState();
    observeReveal(Array.from(partnersGrid.querySelectorAll('.reveal')));
  }

  /* ---------- бегущая строка: что реально есть в каталоге ---------- */
  function renderMarquee() {
    if (!marquee) return;
    const track = marquee.querySelector('.marquee__track');

    // Комплексы берём из каталога — это проверяемый факт: их объекты у нас есть.
    const projects = Array.from(new Set(allItems.map(it => (it.title || '').trim()).filter(Boolean)))
      .map(name => {
        const it = allItems.find(x => (x.title || '').trim() === name);
        return { name, country: it && it.country, dev: false };
      });
    // Застройщики — только подтверждённые в базе партнёров
    const devs = ((channels && channels.companies) || [])
      .filter(c => c.kind === 'developer')
      .map(c => ({ name: c.name, country: c.country, dev: true }));

    const all = devs.concat(projects);
    if (!all.length) { marquee.hidden = true; return; }
    marquee.hidden = false;

    const item = x => `<span class="marquee__item${x.dev ? ' marquee__item--dev' : ''}">
        ${x.country ? `<i class="flag flag--${esc(x.country)} flag--sm" aria-hidden="true"></i>` : ''}${esc(x.name)}
      </span><span class="marquee__dot" aria-hidden="true"></span>`;
    // Лента дублируется: анимация сдвигает ровно на половину и стыкуется без шва
    const once = all.map(item).join('');
    track.innerHTML = once + once;
    // Чем длиннее лента, тем дольше цикл — скорость остаётся одинаковой на глаз
    track.style.animationDuration = Math.max(40, all.length * 2.2) + 's';

    if (marqueeNote) {
      // В русском три формы множественного: 1 комплекс, 2 комплекса, 5 комплексов
      const d = devs.length ? `${devs.length} ${plural(devs.length, 'застройщик', 'застройщика', 'застройщиков')} и ` : '';
      const pr = `${projects.length} ${plural(projects.length, 'комплекс', 'комплекса', 'комплексов')}`;
      marqueeNote.textContent = `${d}${pr}, объекты которых есть в каталоге. ` +
        'Список собирается из каталога автоматически.';
    }
  }

  function renderRegState() {
    if (!regState) return;
    const r = regInfo();
    regState.hidden = !r;
    if (r) {
      regState.innerHTML = `Контакты открыты для <b>${esc(r.name)}</b> · <button type="button" data-reg-reset>сбросить</button>`;
    }
  }

  function openRegModal() {
    setModal('regBox', `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal__title">Открыть контакты</h3>
      <p class="detail__desc">Бесплатно и без подтверждения почты. Оставьте имя и способ связи — контакты агентств и застройщиков откроются сразу и останутся открытыми на этом устройстве.</p>
      <form class="reg-form" id="regForm" novalidate>
        <label class="reg-form__row"><span>Как вас зовут</span>
          <input type="text" id="regName" autocomplete="name" required /></label>
        <label class="reg-form__row"><span>Телефон или @telegram</span>
          <input type="text" id="regContact" autocomplete="tel" required /></label>
        <label class="lead__consent">
          <input type="checkbox" id="regConsent" />
          <span>Согласен на обработку персональных данных и принимаю <a href="privacy/" target="_blank" rel="noopener">политику конфиденциальности</a></span>
        </label>
        <button class="btn btn--gold btn--lg" type="submit" style="width:100%">Открыть контакты</button>
        <p class="lead__hint" id="regHint" aria-live="polite"></p>
      </form>
    `);
    openModal('regModal');
    const form = document.getElementById('regForm');
    const nameEl = document.getElementById('regName');
    const contactEl = document.getElementById('regContact');
    const consentEl = document.getElementById('regConsent');
    const hintEl = document.getElementById('regHint');
    setTimeout(() => nameEl && nameEl.focus(), 150);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let ok = true;
      [nameEl, contactEl].forEach(el => { const bad = !el.value.trim(); el.classList.toggle('err', bad); if (bad) ok = false; });
      if (!ok) { hintEl.textContent = 'Заполните имя и контакт.'; hintEl.className = 'lead__hint lead__hint--err'; return; }
      if (!consentEl.checked) {
        consentEl.closest('.lead__consent').classList.add('err');
        hintEl.textContent = 'Отметьте согласие на обработку персональных данных.';
        hintEl.className = 'lead__hint lead__hint--err';
        return;
      }
      try {
        localStorage.setItem(REG_KEY, JSON.stringify({
          name: nameEl.value.trim(), contact: contactEl.value.trim(), at: new Date().toISOString().slice(0, 10),
        }));
      } catch (err) {}
      loadContacts().then(() => { closeModal(); renderPartners(); });
    });
  }

  function loadContacts() {
    if (contacts) return Promise.resolve(contacts);
    return fetch('data/contacts.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { contacts = d.contacts || {}; return contacts; })
      .catch(() => { contacts = {}; return contacts; });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-reg]')) { openRegModal(); return; }
    if (e.target.closest('[data-reg-reset]')) {
      try { localStorage.removeItem(REG_KEY); } catch (err) {}
      renderPartners();
    }
  });

  if (partnersGrid) {
    fetch('data/channels.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        channels = d;
        return isRegistered() ? loadContacts() : null;
      })
      .then(() => { renderPartners(); renderMarquee(); })
      .catch(() => {
        if (partnersGrid) partnersGrid.innerHTML =
          '<p class="catalog__empty">База партнёров временно недоступна. Напишите нам — пришлём контакты вручную.</p>';
      });
  }

  /* ---------- СЧЁТЧИКИ ЦИФР ---------- */
  const counters = document.querySelectorAll('[data-count]');
  let countersDone = false;
  function runCounters() {
    if (countersDone) return;
    countersDone = true;
    counters.forEach(el => {
      const end = parseInt(el.dataset.count, 10) || 0;
      const dur = 1600; const t0 = performance.now();
      function tick(now) {
        const k = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(end * eased);
        if (k < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  const trust = document.querySelector('.trust');
  if (trust && 'IntersectionObserver' in window) {
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { runCounters(); io2.disconnect(); } });
    }, { threshold: 0.4 });
    io2.observe(trust);
  } else { runCounters(); }

})();
