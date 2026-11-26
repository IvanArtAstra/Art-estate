/* ============================================================
   Estate Art — Регионализация, быстрый онбординг и синхронизация
   кабинета на главной странице.
   ============================================================ */
(function () {
  'use strict';

  const KEY_GEO = 'ae_geo';
  const KEY_ONBOARD = 'ae_onboarding';
  const KEY_USER = 'ae_auth_user';
  const KEY_COUNTRY = 'ae_country';
  const KEY_CURR = 'ae_currency';
  const KEY_TOKEN = 'ae_auth_token';

  const TZ_COUNTRY = {
    'Asia/Bangkok': { country: 'th', countryName: 'Таиланд', city: 'Пхукет', suggestedCurrency: 'THB' },
    'Asia/Ho_Chi_Minh': { country: 'vn', countryName: 'Вьетнам', city: 'Дананг', suggestedCurrency: 'VND' },
    'Asia/Saigon': { country: 'vn', countryName: 'Вьетнам', city: 'Дананг', suggestedCurrency: 'VND' },
    'Europe/Moscow': { country: 'ru', countryName: 'Россия', city: 'Москва', suggestedCurrency: 'RUB' },
    'Asia/Yekaterinburg': { country: 'ru', countryName: 'Россия', city: 'Екатеринбург', suggestedCurrency: 'RUB' },
    'Asia/Novosibirsk': { country: 'ru', countryName: 'Россия', city: 'Новосибирск', suggestedCurrency: 'RUB' },
    'Asia/Dubai': { country: 'ae', countryName: 'ОАЭ', city: 'Дубай', suggestedCurrency: 'USD' },
    'Europe/Istanbul': { country: 'tr', countryName: 'Турция', city: 'Стамбул', suggestedCurrency: 'USD' },
    'Asia/Makassar': { country: 'id', countryName: 'Индонезия', city: 'Бали', suggestedCurrency: 'USD' },
    'Asia/Jakarta': { country: 'id', countryName: 'Индонезия', city: 'Джакарта', suggestedCurrency: 'USD' },
    'Asia/Tbilisi': { country: 'ge', countryName: 'Грузия', city: 'Тбилиси', suggestedCurrency: 'USD' },
    'Asia/Almaty': { country: 'kz', countryName: 'Казахстан', city: 'Алматы', suggestedCurrency: 'USD' },
  };

  function resolveApiEndpoint() {
    let ep = (document.body.dataset.chatEndpoint || '').replace(/\/+$/, '');
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) {
      try {
        const q = new URLSearchParams(location.search).get('api');
        if (q && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(q)) {
          ep = q.replace(/\/+$/, '');
          sessionStorage.setItem('ae_api_override', ep);
        } else {
          const saved = sessionStorage.getItem('ae_api_override');
          if (saved) ep = saved;
        }
      } catch {}
    }
    return ep;
  }

  const ENDPOINT = resolveApiEndpoint();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let geo = null;

  async function detectGeo() {
    try {
      const cached = sessionStorage.getItem(KEY_GEO);
      if (cached) geo = JSON.parse(cached);
    } catch {}
    if (!geo && ENDPOINT) {
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 3500);
        const r = await fetch(ENDPOINT + '/api/geo', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(tm);
        if (r.ok) geo = await r.json();
      } catch {}
    }
    if (!geo || !geo.country) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const hit = TZ_COUNTRY[tz];
        if (hit) geo = Object.assign({ ok: true, timezone: tz }, hit);
      } catch {}
    }
    if (geo) {
      window.EstateGeo = geo;
      try { sessionStorage.setItem(KEY_GEO, JSON.stringify(geo)); } catch {}
    }
    return geo;
  }

  function syncCabinetLinks() {
    const user = store.get(KEY_USER, null);
    const hdr = $('#headerCabinet');
    const drw = $('#drawerCabinet');
    if (user && user.name) {
      const label = esc(user.name.split(' ')[0]);
      if (hdr) {
        hdr.classList.add('is-authed');
        hdr.innerHTML = `<span class="cab-dot" aria-hidden="true"></span><span>${label}</span>`;
      }
      if (drw) {
        drw.classList.add('is-authed');
        drw.textContent = `Кабинет · ${user.name}`;
      }
    }
  }

  /* ---------- ПАНЕЛЬ РЕГИОНАЛИСТИКИ И ПОДБОРА НАД КАТАЛОГОМ ---------- */
  function renderPersonalBar() {
    const bar = $('#personalBar');
    if (!bar) return;
    const cat = window.EstateCatalog;
    if (!cat) return;

    const ob = store.get(KEY_ONBOARD, null);
    const items = cat.getItems();
    const g = geo || window.EstateGeo;

    if (ob && (ob.goal || ob.country || ob.type || ob.budget)) {
      const goalNames = { live: 'Жить у моря', invest: 'Инвестиции', rent: 'Аренда', sell: 'Размещение' };
      const tags = [
        ob.goal && (goalNames[ob.goal] || ob.goal),
        ob.countryName || (ob.country ? ob.country.toUpperCase() : 'Любой регион'),
        ob.type,
        ob.budget ? (Number(ob.budget) > 500000 ? '$500k+' : 'до $' + Math.round(Number(ob.budget) / 1000) + 'k') : '',
      ].filter(Boolean);

      bar.hidden = false;
      bar.innerHTML = `
        <div class="personal-bar__txt">
          <span class="personal-bar__badge">Подбор</span>
          <span>Настроено для вас: <b>${esc(tags.join(' · '))}</b></span>
        </div>
        <div class="personal-bar__actions">
          <button type="button" class="personal-bar__btn" data-open-onboarding>Изменить</button>
          <button type="button" class="personal-bar__btn" data-reset-onboarding>Показать все</button>
          <button type="button" class="personal-bar__btn personal-bar__btn--accent" data-ai-onboarding>Спросить ИИ</button>
        </div>
      `;
      return;
    }

    if (g && (g.city || g.countryName)) {
      const place = [g.city, g.countryName].filter(Boolean).join(', ');
      const hasLocal = g.country && items.some(it => String(it.country || '').toLowerCase() === g.country);
      const curCountry = cat.getCountry();

      bar.hidden = false;
      bar.innerHTML = `
        <div class="personal-bar__txt">
          <span class="personal-bar__badge">Регион</span>
          <span>Вы заходите из: <b>${esc(place)}</b> · ${
            hasLocal && curCountry === g.country
              ? 'показаны объекты вашего региона'
              : hasLocal
                ? 'есть объекты в вашем регионе'
                : 'подберите направление за 15 секунд или разместите объект у себя'
          }</span>
        </div>
        <div class="personal-bar__actions">
          ${hasLocal && curCountry !== g.country
            ? `<button type="button" class="personal-bar__btn" data-pick-region="${esc(g.country)}">Только ${esc(g.countryName)}</button>`
            : ''}
          ${hasLocal && curCountry === g.country
            ? `<button type="button" class="personal-bar__btn" data-pick-region="">Все регионы</button>`
            : ''}
          <button type="button" class="personal-bar__btn personal-bar__btn--accent" data-open-onboarding>Быстрый подбор</button>
          <a href="cabinet/#add" class="personal-bar__btn">+ Разместить объект</a>
        </div>
      `;
    }
  }

  /* ---------- БЫСТРЫЙ 3-ШАГОВЫЙ ОНБОРДИНГ ---------- */
  let obState = { step: 1, goal: '', country: '', countryName: '', type: '', budget: '' };

  function availableRegions() {
    const cat = window.EstateCatalog;
    const items = cat ? cat.getItems() : [];
    const map = new Map();
    items.forEach(it => {
      if (!it.country) return;
      const code = String(it.country).toLowerCase();
      if (!map.has(code)) map.set(code, { code, name: it.countryName || code.toUpperCase(), count: 0 });
      map.get(code).count++;
    });
    if (!map.has('th')) map.set('th', { code: 'th', name: 'Таиланд', count: 0 });
    if (!map.has('vn')) map.set('vn', { code: 'vn', name: 'Вьетнам', count: 0 });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  function renderOnboardingStep() {
    const box = $('#onboardingBox');
    if (!box) return;
    const g = geo || window.EstateGeo;
    const regions = availableRegions();

    let bodyHtml = '';
    if (obState.step === 1) {
      const goals = [
        { id: 'live', title: 'Жить или переехать', sub: 'Подберём район, формат владения и инфраструктуру' },
        { id: 'invest', title: 'Инвестиции и доход', sub: 'Ликвидные комплексы с понятной доходностью' },
        { id: 'rent', title: 'Арендовать жильё', sub: 'Проверенные квартиры и виллы с прозрачными условиями' },
        { id: 'sell', title: 'Разместить свой объект', sub: 'Перейти в личный кабинет и загрузить фото за 2 минуты' },
      ];
      bodyHtml = `
        <h3 class="modal__title">Что для вас сейчас главное?</h3>
        <p class="onboard__sub">Шаг 1 из 3 — настроим каталог и ИИ-консультанта под вашу задачу.</p>
        <div class="onboard__grid">
          ${goals.map(gl => `
            <button type="button" class="onboard__card${obState.goal === gl.id ? ' is-active' : ''}" data-ob-goal="${gl.id}">
              <b>${gl.title}</b>
              <span>${gl.sub}</span>
            </button>
          `).join('')}
        </div>
      `;
    } else if (obState.step === 2) {
      bodyHtml = `
        <h3 class="modal__title">Какой регион интересен?</h3>
        <p class="onboard__sub">Шаг 2 из 3${g && g.countryName ? ` · ваш регион входа: ${esc(g.countryName)}` : ''}.</p>
        <div class="onboard__chips">
          <button type="button" class="onboard__chip${!obState.country ? ' is-active' : ''}" data-ob-country="" data-ob-cname="Любой регион">Любой регион</button>
          ${regions.map(r => `
            <button type="button" class="onboard__chip${obState.country === r.code ? ' is-active' : ''}" data-ob-country="${esc(r.code)}" data-ob-cname="${esc(r.name)}">
              ${esc(r.name)}${r.count ? ` (${r.count})` : ''}${g && g.country === r.code ? ' · вы здесь' : ''}
            </button>
          `).join('')}
        </div>
        <div class="onboard__nav">
          <button type="button" class="btn btn--ghost cab-btn-dark btn--sm" data-ob-prev>← Назад</button>
          <button type="button" class="btn btn--gold btn--sm" data-ob-next>Далее →</button>
        </div>
      `;
    } else {
      const types = [
        { v: '', label: 'Любой тип' },
        { v: 'Вилла', label: 'Вилла' },
        { v: 'Кондо', label: 'Кондо / Квартира' },
        { v: 'Апартаменты', label: 'Апартаменты' },
        { v: 'Пентхаус', label: 'Пентхаус' },
      ];
      const budgets = [
        { v: '', label: 'Любой' },
        { v: '100000', label: 'до $100k' },
        { v: '250000', label: 'до $250k' },
        { v: '500000', label: 'до $500k' },
        { v: '500001', label: '$500k+' },
      ];
      const user = store.get(KEY_USER, null);
      bodyHtml = `
        <h3 class="modal__title">Тип жилья и ориентир бюджета</h3>
        <p class="onboard__sub">Шаг 3 из 3 — сразу покажем подходящие варианты.</p>
        <div class="onboard__sec">
          <span class="onboard__label">Формат</span>
          <div class="onboard__chips">
            ${types.map(t => `<button type="button" class="onboard__chip${obState.type === t.v ? ' is-active' : ''}" data-ob-type="${esc(t.v)}">${t.label}</button>`).join('')}
          </div>
        </div>
        <div class="onboard__sec">
          <span class="onboard__label">Бюджет</span>
          <div class="onboard__chips">
            ${budgets.map(b => `<button type="button" class="onboard__chip${obState.budget === b.v ? ' is-active' : ''}" data-ob-budget="${esc(b.v)}">${b.label}</button>`).join('')}
          </div>
        </div>
        ${!user ? `
          <div class="onboard__contact">
            <span class="onboard__label">Хотите получить подборку от менеджера? (необязательно)</span>
            <div class="onboard__row">
              <input type="text" id="obName" placeholder="Ваше имя" />
              <input type="text" id="obContact" placeholder="Телефон или @telegram" />
            </div>
            <label class="lead__consent cab-consent" style="margin-top:.5rem">
              <input type="checkbox" id="obConsent" />
              <span>Согласен на обработку данных и принимаю <a href="privacy/" target="_blank" rel="noopener">политику конфиденциальности</a></span>
            </label>
          </div>
        ` : ''}
        <p class="cab-hint" id="obHint"></p>
        <div class="onboard__nav">
          <button type="button" class="btn btn--ghost cab-btn-dark btn--sm" data-ob-prev>← Назад</button>
          <button type="button" class="btn btn--gold" data-ob-finish>Показать объекты →</button>
        </div>
      `;
    }

    box.innerHTML = `
      <button class="modal__close" data-close aria-label="Закрыть">×</button>
      <div class="onboard__progress"><span style="width:${(obState.step / 3 * 100).toFixed(0)}%"></span></div>
      ${bodyHtml}
    `;
  }

  function openOnboardingModal() {
    const saved = store.get(KEY_ONBOARD, null) || {};
    const g = geo || window.EstateGeo;
    obState = {
      step: 1,
      goal: saved.goal || '',
      country: saved.country != null ? saved.country : (g && g.country && availableRegions().some(r => r.code === g.country) ? g.country : ''),
      countryName: saved.countryName || '',
      type: saved.type || '',
      budget: saved.budget || '',
    };
    renderOnboardingStep();
    if (window.EstateCatalog && window.EstateCatalog.openModal) {
      window.EstateCatalog.openModal('onboardingModal');
    } else {
      const m = $('#onboardingModal');
      if (m) { m.hidden = false; m.classList.add('open'); }
    }
  }

  function closeOnboardingModal() {
    if (window.EstateCatalog && window.EstateCatalog.closeModal) {
      window.EstateCatalog.closeModal($('#onboardingModal'));
    } else {
      const m = $('#onboardingModal');
      if (m) { m.classList.remove('open'); m.hidden = true; }
    }
  }

  async function finishOnboarding() {
    const nameEl = $('#obName');
    const contactEl = $('#obContact');
    const consentEl = $('#obConsent');
    const hint = $('#obHint');
    const name = nameEl ? nameEl.value.trim() : '';
    const contact = contactEl ? contactEl.value.trim() : '';

    if (contact && consentEl && !consentEl.checked) {
      if (hint) { hint.textContent = 'Отметьте согласие на обработку персональных данных.'; hint.className = 'cab-hint is-err'; }
      return;
    }

    const payload = {
      goal: obState.goal,
      country: obState.country,
      countryName: obState.countryName,
      type: obState.type,
      budget: obState.budget,
      updatedAt: new Date().toISOString(),
    };
    store.set(KEY_ONBOARD, payload);

    if (window.EstateCatalog && window.EstateCatalog.applyOnboarding) {
      window.EstateCatalog.applyOnboarding(payload);
    }
    renderPersonalBar();
    closeOnboardingModal();

    const catEl = document.getElementById('catalog');
    if (catEl) catEl.scrollIntoView({ behavior: 'smooth' });

    if (ENDPOINT) {
      let tok = '';
      try { tok = localStorage.getItem(KEY_TOKEN) || ''; } catch {}
      const headers = { 'content-type': 'application/json' };
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
      fetch(ENDPOINT + '/api/onboarding', {
        method: 'POST',
        headers,
        body: JSON.stringify(Object.assign({}, payload, { name, contact, geo })),
        keepalive: true,
      }).catch(() => {});
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#onboardingTrigger') || e.target.closest('[data-open-onboarding]')) {
      openOnboardingModal();
      return;
    }
    const pickReg = e.target.closest('[data-pick-region]');
    if (pickReg && window.EstateCatalog) {
      window.EstateCatalog.setCountry(pickReg.dataset.pickRegion);
      renderPersonalBar();
      return;
    }
    if (e.target.closest('[data-reset-onboarding]')) {
      store.del(KEY_ONBOARD);
      if (window.EstateCatalog) window.EstateCatalog.resetFilters();
      renderPersonalBar();
      return;
    }
    if (e.target.closest('[data-ai-onboarding]') && window.EstateChat) {
      const ob = store.get(KEY_ONBOARD, {});
      window.EstateChat.openWithPrompt(
        `Посоветуйте, пожалуйста, объекты под мой запрос (${[ob.goal, ob.countryName || ob.country, ob.type, ob.budget].filter(Boolean).join(', ') || 'подбор на сайте'}).`
      );
      return;
    }

    const goalBtn = e.target.closest('[data-ob-goal]');
    if (goalBtn) {
      obState.goal = goalBtn.dataset.obGoal;
      if (obState.goal === 'sell') {
        window.location.href = 'cabinet/#add';
        return;
      }
      obState.step = 2;
      renderOnboardingStep();
      return;
    }
    const cntBtn = e.target.closest('[data-ob-country]');
    if (cntBtn) {
      obState.country = cntBtn.dataset.obCountry;
      obState.countryName = cntBtn.dataset.obCname || '';
      renderOnboardingStep();
      return;
    }
    const typeBtn = e.target.closest('[data-ob-type]');
    if (typeBtn) {
      obState.type = typeBtn.dataset.obType;
      renderOnboardingStep();
      return;
    }
    const budBtn = e.target.closest('[data-ob-budget]');
    if (budBtn) {
      obState.budget = budBtn.dataset.obBudget;
      renderOnboardingStep();
      return;
    }
    if (e.target.closest('[data-ob-prev]')) {
      obState.step = Math.max(1, obState.step - 1);
      renderOnboardingStep();
      return;
    }
    if (e.target.closest('[data-ob-next]')) {
      obState.step = Math.min(3, obState.step + 1);
      renderOnboardingStep();
      return;
    }
    if (e.target.closest('[data-ob-finish]')) {
      finishOnboarding();
    }
  });

  async function init() {
    syncCabinetLinks();
    await detectGeo();

    if (window.EstateCatalog && window.EstateCatalog.onReady) {
      window.EstateCatalog.onReady((items) => {
        let manualCountry = null;
        try { manualCountry = localStorage.getItem(KEY_COUNTRY); } catch {}
        const savedOb = store.get(KEY_ONBOARD, null);

        if (savedOb) {
          window.EstateCatalog.applyOnboarding(savedOb);
        } else if (manualCountry == null && geo && geo.country) {
          const hasLocal = items.some(it => String(it.country || '').toLowerCase() === geo.country);
          if (hasLocal) {
            window.EstateCatalog.setCountry(geo.country, { auto: true });
          }
          try {
            if (!localStorage.getItem(KEY_CURR) && geo.suggestedCurrency && ['USD', 'RUB', 'THB', 'VND'].includes(geo.suggestedCurrency)) {
              window.EstateCatalog.setCurrency(geo.suggestedCurrency, { auto: true });
            }
          } catch {}
        }
        renderPersonalBar();
      });
    }
  }

  init();
})();
