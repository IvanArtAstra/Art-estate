/* ============================================================
   ART ESTATE — интерактив
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
  const fDistrict = document.getElementById('fDistrict');
  const fBeds = document.getElementById('fBeds');
  const fPrice = document.getElementById('fPrice');
  const fSort = document.getElementById('fSort');
  const fFav = document.getElementById('fFav');
  const fReset = document.getElementById('fReset');
  const catalogCount = document.getElementById('catalogCount');
  const catalogEmpty = document.getElementById('catalogEmpty');
  const catalogMore = document.getElementById('catalogMore');

  let allItems = [];
  const compare = new Set();
  const MAX_COMPARE = 4;
  const PAGE_SIZE = 9;
  let shown = PAGE_SIZE;
  let favOnly = false;

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

  function metaLine(it) {
    const p = [];
    if (it.location) p.push(esc(it.location));
    if (typeof it.beds === 'number' && it.beds > 0) p.push(it.beds + ' ' + plural(it.beds, 'спальня', 'спальни', 'спален'));
    else if (it.beds) p.push(esc(it.beds));
    if (it.baths) p.push(it.baths + ' с/у');
    if (it.area) p.push(esc(it.area) + ' м²');
    return p.join(' · ');
  }
  function cardHTML(it) {
    const img = it.image || 'assets/hero-phuket.jpg';
    const tag = it.type ? `<span class="card__tag">${esc(it.type)}</span>` : '';
    const beach = it.beach ? `<p class="card__beach">${esc(it.beach)}</p>` : '';
    const per = ppm(it);
    const onCmp = compare.has(String(it.id)) ? ' is-active' : '';
    const onFav = favorites.has(String(it.id)) ? ' is-active' : '';
    const yld = grossYield(it);
    const badges = [];
    if (yld) badges.push(`<span class="badge badge--yield">${yld.toFixed(0)}% доходность</span>`);
    if (it.discountPct) badges.push(`<span class="badge badge--disc">−${it.discountPct}%</span>`);
    const oldPrice = it.oldPriceUSD ? `<s>${money(it.oldPriceUSD)}</s>` : '';
    return `<article class="card reveal" data-id="${esc(it.id)}">
      <div class="card__media">
        <img src="${esc(img)}" alt="${esc(it.title || 'Объект на Пхукете')}" loading="lazy" onerror="this.onerror=null;this.src='assets/hero-phuket.jpg'"/>
        ${tag}
        ${badges.length ? `<div class="card__badges">${badges.join('')}</div>` : ''}
        <button class="card__fav${onFav}" data-action="fav" data-id="${esc(it.id)}" type="button" aria-label="В избранное" aria-pressed="${onFav ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s-7.5-4.6-10-9.2C.3 8.4 1.8 4.9 5.2 4.9c2 0 3.3 1.1 4.1 2.3.8-1.2 2.1-2.3 4.1-2.3 3.4 0 4.9 3.5 3.2 6.9C19.5 16.4 12 21 12 21z"/></svg>
        </button>
        <button class="card__compare${onCmp}" data-action="compare" data-id="${esc(it.id)}" type="button" aria-label="Добавить в сравнение">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg><span>Сравнить</span>
        </button>
      </div>
      <div class="card__body">
        <h3>${esc(it.title || 'Объект на Пхукете')}</h3>
        <p class="card__meta">${metaLine(it)}</p>
        ${beach}
        <div class="card__bottom">
          <span class="card__price">${oldPrice}${it.priceUSD ? money(it.priceUSD) : esc(it.priceLabel || 'Цена по запросу')}${per ? `<small>≈ ${money(per)}/м²</small>` : ''}</span>
          ${it.url ? `<a class="card__link" href="${esc(it.url)}">Подробнее <span class="card__arrow">→</span></a>` : `<button class="card__link" data-action="detail" data-id="${esc(it.id)}" type="button">Подробнее <span class="card__arrow">→</span></button>`}
        </div>
      </div>
    </article>`;
  }

  function getFilters() {
    return {
      q: (fSearch && fSearch.value || '').trim().toLowerCase(),
      type: fType && fType.value || '',
      district: fDistrict && fDistrict.value || '',
      beds: fBeds && fBeds.value || '',
      price: fPrice && fPrice.value || '',
      sort: fSort && fSort.value || 'default',
    };
  }
  function matches(it, f) {
    if (favOnly && !favorites.has(String(it.id))) return false;
    if (f.q) { const hay = ((it.title || '') + ' ' + (it.location || '') + ' ' + (it.type || '')).toLowerCase(); if (!hay.includes(f.q)) return false; }
    if (f.type && it.type !== f.type) return false;
    if (f.district && district(it) !== f.district) return false;
    if (f.beds) { const b = typeof it.beds === 'number' ? it.beds : 0; if (f.beds === '4') { if (b < 4) return false; } else if (String(b) !== f.beds) return false; }
    if (f.price) { const [lo, hi] = f.price.split('-').map(Number); const p = it.priceUSD || 0; if (p < lo || p > hi) return false; }
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
    if (catalogCount) catalogCount.textContent = list.length ? ('Найдено объектов: ' + list.length + (favOnly ? ' · избранное' : '')) : '';
    if (catalogEmpty) catalogEmpty.hidden = list.length > 0;
    if (catalogMore) catalogMore.hidden = list.length <= shown;
  }

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
    grid && grid.querySelectorAll('.card__compare').forEach(btn => btn.classList.toggle('is-active', compare.has(String(btn.dataset.id))));
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
      ['Тип', it => esc(it.type || '—')],
      ['Цена', it => `<b>${it.priceUSD ? money(it.priceUSD) : esc(it.priceLabel || '—')}</b>`],
      ['Цена за м²', it => ppm(it) ? money(ppm(it)) : '—'],
      ['Спальни', it => (it.beds != null ? esc(it.beds) : '—')],
      ['Санузлы', it => (it.baths != null ? esc(it.baths) : '—')],
      ['Площадь', it => it.area ? esc(it.area) + ' м²' : '—'],
      ['Локация', it => esc(it.location || '—')],
      ['У пляжа', it => esc(it.beach || '—')],
      ['Аренда/мес', it => rentOf(it) ? money(rentOf(it)) : '—'],
      ['Доходность, брутто', it => { const r = rentOf(it); return (r && it.priceUSD) ? (r * 12 / it.priceUSD * 100).toFixed(1) + '% годовых' : '—'; }],
    ];
    const head = '<th></th>' + items.map(it => `<th><div class="cmp-h"><img src="${esc(it.image || 'assets/hero-phuket.jpg')}" alt=""/><span>${esc(it.title || 'Объект')}</span></div></th>`).join('');
    const body = rows.map(([label, fn]) => `<tr><td class="cmp-label">${label}</td>${items.map(it => `<td>${fn(it)}</td>`).join('')}</tr>`).join('');
    const cta = items.map(it => `<td><button class="btn btn--gold btn--sm" data-action="detail" data-id="${esc(it.id)}" type="button">Открыть</button></td>`).join('');
    setModal('compareBox', `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <h3 class="modal__title">Сравнение объектов</h3>
      <div class="cmp-scroll"><table class="cmp-table"><thead><tr>${head}</tr></thead><tbody>${body}<tr><td></td>${cta}</tr></tbody></table></div>
    `);
    openModal('compareModal');
  }

  /* ---------- КАРТОЧКА ОБЪЕКТА + КАЛЬКУЛЯТОРЫ ---------- */
  function specRow(label, val) { return val ? `<div class="spec"><span>${label}</span><b>${val}</b></div>` : ''; }
  function calcGridHTML(price, rent, fromListing) {
    return `<div class="calc-grid">
        <div class="calc" id="calcMortgage" data-price="${price}">
          <h4>Кредитный калькулятор</h4>
          <label class="calc__row">Стоимость, $<input type="number" id="m_price" value="${price}" min="0" step="1000"></label>
          <label class="calc__row">Первоначальный взнос: <output id="m_down_v">30%</output><input type="range" id="m_down" min="0" max="90" value="30" step="5"></label>
          <label class="calc__row">Ставка, % годовых<input type="number" id="m_rate" value="6" min="0" max="30" step="0.1"></label>
          <label class="calc__row">Срок: <output id="m_term_v">20 лет</output><input type="range" id="m_term" min="5" max="30" value="20" step="1"></label>
          <div class="calc__out">
            <div><span>Платёж / мес</span><b id="m_payment">—</b></div>
            <div><span>Сумма кредита</span><b id="m_loan">—</b></div>
            <div><span>Переплата</span><b id="m_interest">—</b></div>
          </div>
          <p class="calc__note">Ориентировочный расчёт аннуитетного платежа. Условия зависят от банка и статуса покупателя.</p>
        </div>
        <div class="calc" id="calcRoi">
          <h4>Калькулятор доходности</h4>
          <label class="calc__row">Стоимость, $<input type="number" id="r_price" value="${price}" min="0" step="1000"></label>
          <label class="calc__row">Аренда / мес, $<input type="number" id="r_rent" value="${rent}" min="0" step="50"></label>
          <label class="calc__row">Загрузка: <output id="r_occ_v">75%</output><input type="range" id="r_occ" min="30" max="100" value="75" step="5"></label>
          <div class="calc__out">
            <div><span>Доход / год</span><b id="r_annual">—</b></div>
            <div><span>Доходность</span><b id="r_yield">—</b></div>
            <div><span>Окупаемость</span><b id="r_payback">—</b></div>
          </div>
          <p class="calc__note">${fromListing ? 'Аренда взята с объявления.' : 'Аренда оценочная (≈6% годовых). Уточните у нас.'} Расчёт без учёта налогов и комиссий УК.</p>
        </div>
      </div>`;
  }
  function buildDetail(it) {
    const img = it.image || 'assets/hero-phuket.jpg';
    const per = ppm(it);
    const beds = (typeof it.beds === 'number' && it.beds > 0) ? it.beds + ' ' + plural(it.beds, 'спальня', 'спальни', 'спален') : (it.beds ? esc(it.beds) : '');
    const wa = 'https://wa.me/79124869508?text=' + encodeURIComponent('Здравствуйте! Интересует объект «' + (it.title || '') + '» с сайта Art Estate.');
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
      <h3 class="modal__title">Калькуляторы покупки</h3>
      <p class="detail__desc">Прикиньте ежемесячный платёж по кредиту и доходность от аренды. Значения примерные — точные условия рассчитаем индивидуально.</p>
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
      $('m_term_v').textContent = years + ' ' + plural(years, 'год', 'года', 'лет');
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
      $('r_payback').textContent = annual ? (price / annual).toFixed(1) + ' ' + plural(Math.round(price / annual), 'год', 'года', 'лет') : '—';
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
  [fSearch, fType, fDistrict, fBeds, fPrice, fSort].forEach(el => el && el.addEventListener('input', () => render(true)));
  fFav && fFav.addEventListener('click', () => {
    favOnly = !favOnly;
    fFav.classList.toggle('is-active', favOnly);
    fFav.setAttribute('aria-pressed', favOnly ? 'true' : 'false');
    render(true);
  });
  fReset && fReset.addEventListener('click', () => {
    [fSearch, fType, fDistrict, fBeds, fPrice].forEach(el => el && (el.value = ''));
    if (fSort) fSort.value = 'default';
    favOnly = false;
    if (fFav) { fFav.classList.remove('is-active'); fFav.setAttribute('aria-pressed', 'false'); }
    render(true);
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
    const ds = districtStats().slice(0, 8);
    wrap.innerHTML = ds.map(d => `
      <button class="dcard reveal" data-district="${esc(d.name)}" type="button">
        <img src="${esc(d.image || 'assets/hero-phuket.jpg')}" alt="${esc(d.name)}" loading="lazy" onerror="this.onerror=null;this.src='assets/hero-phuket.jpg'"/>
        <span class="dcard__name">${esc(d.name)}</span>
        <span class="dcard__count">${d.count} ${plural(d.count, 'объект', 'объекта', 'объектов')}</span>
      </button>`).join('');
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
  function openDrawer() { if (!drawer) return; drawer.hidden = false; drawer.setAttribute('aria-hidden', 'false'); requestAnimationFrame(() => drawer.classList.add('open')); document.body.style.overflow = 'hidden'; }
  function closeDrawer() { if (!drawer) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); setTimeout(() => { drawer.hidden = true; }, 350); document.body.style.overflow = ''; }
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
    render();
    renderUrgent();
    refreshAllMap();
  }
  currSwitch && currSwitch.addEventListener('click', (e) => { const b = e.target.closest('[data-curr]'); if (b) setCurrency(b.dataset.curr); });

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
  let allMap = null, allMarkers = [];
  function refreshAllMap() {
    if (typeof L === 'undefined') return;
    const el = document.getElementById('mapAll'); if (!el) return;
    const pts = allItems.filter(it => it.lat && it.lng);
    if (!pts.length) return;
    if (allMap) { allMarkers.forEach(m => allMap.removeLayer(m)); allMarkers = []; }
    else {
      allMap = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(allMap);
    }
    const group = [];
    pts.forEach(it => {
      const m = L.marker([it.lat, it.lng]).addTo(allMap);
      m.bindPopup(`<div class="mappopup"><b>${esc(it.title || 'Объект')}</b><span>${money(it.priceUSD)}</span><button data-action="detail" data-id="${esc(it.id)}" type="button">Подробнее</button></div>`);
      allMarkers.push(m); group.push([it.lat, it.lng]);
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
    allItems = items.map((it, i) => Object.assign({}, it, { id: it.id != null ? String(it.id) : 'demo' + i }));
    // типы для фильтра
    if (fType) {
      const types = Array.from(new Set(allItems.map(it => it.type).filter(Boolean))).sort();
      fType.insertAdjacentHTML('beforeend', types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join(''));
    }
    if (fDistrict) {
      const ds = Array.from(new Set(allItems.map(district).filter(Boolean))).sort();
      fDistrict.insertAdjacentHTML('beforeend', ds.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join(''));
    }
    // активная валюта в переключателе
    if (currSwitch) currSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.curr === currency));
    render(true);
    renderDistricts();
    renderSearchChips();
    renderUrgent();
    refreshAllMap();
    const upd = document.getElementById('catalogUpdated');
    if (upd && data && data.updated) upd.textContent = 'Каталог обновлён ' + data.updated + ' · источник: ' + (data.source || '—');
  }
  if (grid) {
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
      const text = 'Заявка с сайта Art Estate\nИмя: ' + nameEl.value.trim() +
        '\nКонтакт: ' + phoneEl.value.trim() +
        (msgEl && msgEl.value.trim() ? '\nЗапрос: ' + msgEl.value.trim() : '');
      if (hintEl) hintEl.textContent = 'Открываем WhatsApp с вашей заявкой…';
      window.open('https://wa.me/79124869508?text=' + encodeURIComponent(text), '_blank', 'noopener');
    });
    [nameEl, phoneEl].forEach(el => el && el.addEventListener('input', () => el.classList.remove('err')));
    consentEl && consentEl.addEventListener('change', () => { const c = consentEl.closest('.lead__consent'); if (c) c.classList.remove('err'); });
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
