/* ============================================================
   Estate Art — Логика личного кабинета (/cabinet/)
   ============================================================ */
(function () {
  'use strict';

  const KEY_TOKEN = 'ae_auth_token';
  const KEY_USER = 'ae_auth_user';
  const KEY_REG = 'ae_reg';
  const KEY_FAV = 'ae_favorites';
  const KEY_ONBOARD = 'ae_onboarding';
  const KEY_GEO = 'ae_geo';

  const ROLE_LABELS = {
    buyer: 'Покупатель / Инвестор',
    renter: 'Арендатор',
    owner: 'Собственник',
    partner: 'Агент / Застройщик',
  };
  const STATUS_LABELS = {
    approved: 'Опубликован',
    pending: 'На проверке',
    rejected: 'Отклонён',
    draft: 'Черновик',
  };
  const RATES_TO_USD = {
    USD: 1,
    EUR: 1.09,
    RUB: 1 / 92,
    THB: 1 / 36.5,
    VND: 1 / 26000,
    AED: 1 / 3.67,
  };
  const CITY_COORDS = {
    'Пхукет': [7.8804, 98.3923],
    'Дананг': [16.0545, 108.2022],
    'Нячанг': [12.2388, 109.1967],
    'Бангкок': [13.7563, 100.5018],
    'Паттайя': [12.9236, 100.8825],
    'Аланья': [36.5444, 31.9954],
    'Анталья': [36.8969, 30.7133],
    'Дубай': [25.2048, 55.2708],
    'Чангу': [-8.6478, 115.1385],
    'Батуми': [41.6168, 41.6367],
    'Тбилиси': [41.7151, 44.8271],
    'Сочи': [43.5855, 39.7231],
    'Москва': [55.7558, 37.6173],
    'Санкт-Петербург': [59.9343, 30.3351],
  };
  const TZ_COUNTRY = {
    'Asia/Bangkok': { country: 'th', countryName: 'Таиланд', city: 'Пхукет' },
    'Asia/Ho_Chi_Minh': { country: 'vn', countryName: 'Вьетнам', city: 'Дананг' },
    'Asia/Saigon': { country: 'vn', countryName: 'Вьетнам', city: 'Дананг' },
    'Europe/Moscow': { country: 'ru', countryName: 'Россия', city: 'Москва' },
    'Asia/Yekaterinburg': { country: 'ru', countryName: 'Россия', city: 'Екатеринбург' },
    'Asia/Novosibirsk': { country: 'ru', countryName: 'Россия', city: 'Новосибирск' },
    'Asia/Dubai': { country: 'ae', countryName: 'ОАЭ', city: 'Дубай' },
    'Europe/Istanbul': { country: 'tr', countryName: 'Турция', city: 'Стамбул' },
    'Asia/Makassar': { country: 'id', countryName: 'Индонезия', city: 'Бали' },
    'Asia/Jakarta': { country: 'id', countryName: 'Индонезия', city: 'Джакарта' },
    'Asia/Tbilisi': { country: 'ge', countryName: 'Грузия', city: 'Тбилиси' },
    'Asia/Almaty': { country: 'kz', countryName: 'Казахстан', city: 'Алматы' },
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
      } catch (e) {}
    }
    return ep;
  }

  const API = resolveApiEndpoint();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const nsep = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let token = '';
  try { token = localStorage.getItem(KEY_TOKEN) || ''; } catch {}
  let currentUser = store.get(KEY_USER, null);
  let myListings = [];
  let allCatalog = [];
  let currentGeo = null;
  let editorDeal = 'sale';
  let editorPhotos = [];
  let editorFeatures = new Set();
  let miniMap = null;
  let miniMarker = null;

  async function apiFetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && typeof opts.body === 'string' && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    const r = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  function syncLocalAuth(nextToken, user) {
    token = nextToken || '';
    currentUser = user || null;
    if (token && user) {
      try { localStorage.setItem(KEY_TOKEN, token); } catch {}
      store.set(KEY_USER, user);
      store.set(KEY_REG, { name: user.name, contact: user.contact || user.login, at: new Date().toISOString().slice(0, 10) });
      if (Array.isArray(user.favorites) && user.favorites.length) {
        const curFav = new Set((store.get(KEY_FAV, []) || []).map(String));
        user.favorites.forEach(id => curFav.add(String(id)));
        store.set(KEY_FAV, Array.from(curFav));
      }
      if (user.onboarding) store.set(KEY_ONBOARD, user.onboarding);
    } else {
      try { localStorage.removeItem(KEY_TOKEN); } catch {}
      store.del(KEY_USER);
    }
  }

  /* ---------- ГЕОПОЗИЦИЯ ---------- */
  async function loadGeo() {
    try {
      const cached = sessionStorage.getItem(KEY_GEO);
      if (cached) currentGeo = JSON.parse(cached);
    } catch {}
    if (!currentGeo) {
      try {
        const r = await apiFetch('/api/geo');
        if (r.ok && r.data) currentGeo = r.data;
      } catch {}
    }
    if (!currentGeo || !currentGeo.country) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const hit = TZ_COUNTRY[tz];
        if (hit) currentGeo = Object.assign({ timezone: tz }, hit);
      } catch {}
    }
    if (currentGeo) {
      try { sessionStorage.setItem(KEY_GEO, JSON.stringify(currentGeo)); } catch {}
      const pill = $('#cabGeoPill');
      if (pill && (currentGeo.city || currentGeo.countryName)) {
        pill.hidden = false;
        pill.textContent = '📍 ' + [currentGeo.city, currentGeo.countryName].filter(Boolean).join(', ');
      }
    }
  }

  /* ---------- ОБЪЕДИНЁННЫЙ КАТАЛОГ ДЛЯ ПОДБОРКИ И ИЗБРАННОГО ---------- */
  async function loadCatalog() {
    const [catRes, rentRes, dynRes] = await Promise.all([
      fetch('../data/catalog.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('../data/rentals.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
      apiFetch('/api/listings').catch(() => ({ ok: false })),
    ]);
    const list = [];
    if (dynRes.ok && Array.isArray(dynRes.data.items)) {
      list.push(...dynRes.data.items);
    }
    if (catRes && Array.isArray(catRes.items)) {
      list.push(...catRes.items.filter(x => !x.hidden).map(x => Object.assign({}, x, { url: x.url ? '../' + x.url : null })));
    }
    if (rentRes && Array.isArray(rentRes.items)) {
      list.push(...rentRes.items.map(x => Object.assign({ deal: 'rent' }, x, { url: x.url ? '../' + x.url : null })));
    }
    const seen = new Set();
    allCatalog = list.filter(it => {
      const k = String(it.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /* ---------- ПЕРЕКЛЮЧЕНИЕ АВТОРИЗАЦИИ / ДАШБОРДА ---------- */
  const authView = $('#authView');
  const dashView = $('#dashView');
  const logoutBtn = $('#cabLogoutBtn');

  function setAuthMode(mode) {
    document.querySelectorAll('[data-auth-mode]').forEach(b => {
      const on = b.dataset.authMode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#registerForm').hidden = mode !== 'register';
    $('#loginForm').hidden = mode !== 'login';
  }

  document.querySelectorAll('[data-auth-mode]').forEach(b => {
    b.addEventListener('click', () => setAuthMode(b.dataset.authMode));
  });

  function showHint(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'cab-hint' + (kind === 'err' ? ' is-err' : kind === 'ok' ? ' is-ok' : '');
  }

  /* ---------- РЕГИСТРАЦИЯ И ВХОД ---------- */
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#regName').value.trim();
    const login = $('#regLogin').value.trim();
    const password = $('#regPass').value;
    const roleEl = $('input[name="regRole"]:checked');
    const role = roleEl ? roleEl.value : 'buyer';
    const consent = $('#regConsent').checked;
    const hint = $('#regFormHint');

    if (name.length < 2) return showHint(hint, 'Укажите имя (минимум 2 символа).', 'err');
    if (login.length < 3) return showHint(hint, 'Укажите email, телефон или @telegram.', 'err');
    if (password.length < 6) return showHint(hint, 'Пароль должен быть от 6 символов.', 'err');
    if (!consent) return showHint(hint, 'Отметьте согласие на обработку персональных данных.', 'err');

    const btn = $('#regSubmitBtn');
    btn.disabled = true;
    showHint(hint, 'Создаём кабинет…');

    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        login,
        contact: login,
        company: ($('#regCompany') && $('#regCompany').value.trim()) || '',
        password,
        role,
        geo: currentGeo,
        onboarding: store.get(KEY_ONBOARD, null),
        favorites: store.get(KEY_FAV, []),
      }),
    }).catch(() => ({ ok: false, data: { message: 'Сервер недоступен. Попробуйте позже.' } }));

    btn.disabled = false;
    if (!res.ok || !res.data.token) {
      return showHint(hint, (res.data && res.data.message) || 'Не удалось зарегистрироваться.', 'err');
    }

    syncLocalAuth(res.data.token, res.data.user);
    showHint(hint, 'Готово! Открываем ваш кабинет…', 'ok');
    await bootDashboard();
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = $('#loginLogin').value.trim();
    const password = $('#loginPass').value;
    const hint = $('#loginFormHint');

    if (!login || !password) return showHint(hint, 'Введите контакт и пароль.', 'err');
    const btn = $('#loginSubmitBtn');
    btn.disabled = true;
    showHint(hint, 'Проверяем данные…');

    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }).catch(() => ({ ok: false, data: { message: 'Ошибка сети.' } }));

    btn.disabled = false;
    if (!res.ok || !res.data.token) {
      return showHint(hint, (res.data && res.data.message) || 'Неверный логин или пароль.', 'err');
    }

    syncLocalAuth(res.data.token, res.data.user);
    showHint(hint, '');
    await bootDashboard();
  });

  logoutBtn.addEventListener('click', async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    syncLocalAuth('', null);
    authView.hidden = false;
    dashView.hidden = true;
    logoutBtn.hidden = true;
  });

  /* ---------- ТАБЫ ДАШБОРДА ---------- */
  function openTab(tabName) {
    document.querySelectorAll('#dashTabs [data-tab]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tabName);
    });
    document.querySelectorAll('.cab-panel').forEach(p => {
      p.hidden = p.dataset.panel !== tabName;
    });
    if (tabName === 'add' && $('#pMapDetails').open) {
      setTimeout(ensureMiniMap, 120);
    }
    if (location.hash.slice(1) !== tabName) {
      try { history.replaceState(null, '', '#' + tabName); } catch {}
    }
  }

  document.querySelectorAll('#dashTabs [data-tab]').forEach(b => {
    b.addEventListener('click', () => openTab(b.dataset.tab));
  });
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto-tab]');
    if (goto) openTab(goto.dataset.gotoTab);
  });
  $('#dashAddBtn').addEventListener('click', () => { resetPropForm(); openTab('add'); });

  /* ---------- КАРТОЧКИ В ПОДБОРКЕ И ИЗБРАННОМ ---------- */
  function normalizeImg(img) {
    if (!img) return '../assets/hero-phuket.jpg';
    if (/^(https?:|data:|\/|\.\.)/.test(img)) return img;
    return '../' + img;
  }

  function catalogCardHTML(it, isFavTab = false) {
    const img = normalizeImg(it.image);
    const price = it.deal === 'rent'
      ? (it.rentMonthUSD ? `$${nsep(it.rentMonthUSD)} / мес` : esc(it.priceOriginal || 'По запросу'))
      : (it.priceUSD ? `$${nsep(it.priceUSD)}` : esc(it.priceLabel || 'По запросу'));
    const badges = [
      it.type ? `<span class="card__tag">${esc(it.type)}</span>` : '',
      it.ownerListing ? `<span class="badge badge--owner">От собственника</span>` : '',
      it.deal === 'rent' ? `<span class="badge badge--rent">Аренда</span>` : '',
    ].filter(Boolean).join('');
    const meta = [it.location || it.city, it.beds ? `${it.beds} сп.` : '', it.area ? `${it.area} м²` : ''].filter(Boolean).join(' · ');
    const link = it.url
      ? `<a class="card__link" href="${esc(it.url)}">Открыть →</a>`
      : `<button type="button" class="card__link" data-ask-listing="${esc(it.id)}">Спросить ИИ →</button>`;

    return `<article class="card">
      <div class="card__media">
        <img src="${esc(img)}" alt="${esc(it.title || '')}" loading="lazy" onerror="this.onerror=null;this.src='../assets/hero-phuket.jpg'"/>
        <div class="card__badges">${badges}</div>
        ${isFavTab ? `<button class="card__fav is-active" type="button" data-unfav="${esc(it.id)}" aria-label="Убрать из избранного">♥</button>` : ''}
      </div>
      <div class="card__body">
        <span class="card__price">${price}</span>
        <h3>${esc(it.title || 'Объект')}</h3>
        <p class="card__meta">${esc(meta)}</p>
        <div class="card__bottom">
          <button type="button" class="card__ai" data-ask-listing="${esc(it.id)}">Обсудить с ИИ</button>
          ${link}
        </div>
      </div>
    </article>`;
  }

  function renderForYou() {
    const grid = $('#forYouGrid');
    const empty = $('#forYouEmpty');
    const sub = $('#forYouSubtitle');
    const ob = (currentUser && currentUser.onboarding) || store.get(KEY_ONBOARD, null) || {};
    const wantCountry = (ob.country || (currentGeo && currentGeo.country) || '').toLowerCase();

    let items = allCatalog.slice();
    if (ob.goal === 'rent') items = items.filter(x => x.deal === 'rent');
    if (wantCountry && items.some(x => String(x.country || '').toLowerCase() === wantCountry)) {
      items = items.filter(x => String(x.country || '').toLowerCase() === wantCountry);
    }
    if (ob.type) {
      const typed = items.filter(x => String(x.type || '').toLowerCase() === ob.type.toLowerCase());
      if (typed.length) items = typed;
    }
    if (ob.budget) {
      const b = Number(ob.budget);
      if (b && b <= 500000) {
        const byB = items.filter(x => !x.priceUSD || x.priceUSD <= b);
        if (byB.length) items = byB;
      } else if (b > 500000) {
        const byB = items.filter(x => !x.priceUSD || x.priceUSD >= 500000);
        if (byB.length) items = byB;
      }
    }

    const parts = [];
    if (wantCountry && items[0] && items[0].countryName) parts.push('регион: ' + items[0].countryName);
    else if (currentGeo && currentGeo.countryName) parts.push('ваш регион: ' + currentGeo.countryName);
    if (ob.type) parts.push('тип: ' + ob.type);
    if (ob.budget) parts.push('бюджет: ' + (Number(ob.budget) > 500000 ? '$500k+' : 'до $' + nsep(Number(ob.budget))));
    sub.textContent = parts.length
      ? 'Подобрано с учётом параметров — ' + parts.join(' · ')
      : 'Актуальные объекты из каталога и от собственников.';

    const top = items.slice(0, 9);
    grid.innerHTML = top.map(it => catalogCardHTML(it, false)).join('');
    empty.hidden = top.length > 0;
  }

  function renderFavorites() {
    const favIds = new Set((store.get(KEY_FAV, []) || []).concat((currentUser && currentUser.favorites) || []).map(String));
    $('#favCount').textContent = favIds.size;
    const items = allCatalog.filter(it => favIds.has(String(it.id)));
    $('#favGrid').innerHTML = items.map(it => catalogCardHTML(it, true)).join('');
    $('#favEmpty').hidden = items.length > 0;
  }

  /* ---------- МОИ ОБЪЕКТЫ ---------- */
  function renderMyObjects() {
    $('#myObjectsCount').textContent = myListings.length;
    const counts = { total: myListings.length, approved: 0, pending: 0, draft: 0 };
    myListings.forEach(p => { if (counts[p.status] != null) counts[p.status]++; });

    $('#myStats').innerHTML = `
      <div class="cab-stat"><b>${counts.total}</b><span>Всего объектов</span></div>
      <div class="cab-stat"><b>${counts.approved}</b><span>На сайте</span></div>
      <div class="cab-stat"><b>${counts.pending}</b><span>На проверке</span></div>
      <div class="cab-stat"><b>${counts.draft}</b><span>Черновики</span></div>
    `;

    const listEl = $('#myObjectsList');
    const emptyEl = $('#myObjectsEmpty');
    if (!myListings.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = myListings.map(p => {
      const img = p.image || '../assets/hero-phuket.jpg';
      const price = p.deal === 'rent'
        ? (p.rentMonthUSD ? `$${nsep(p.rentMonthUSD)} / мес` : esc(p.priceOriginal || '—'))
        : (p.priceUSD ? `$${nsep(p.priceUSD)}` : esc(p.priceOriginal || '—'));
      const st = p.status || 'pending';
      return `<article class="cab-my-card">
        <div class="cab-my-card__media">
          <img src="${esc(img)}" alt="${esc(p.title)}" onerror="this.onerror=null;this.src='../assets/hero-phuket.jpg'"/>
          <span class="cab-status cab-status--${esc(st)}">${esc(STATUS_LABELS[st] || st)}</span>
        </div>
        <div class="cab-my-card__body">
          <span class="cab-my-card__price">${price}</span>
          <h3>${esc(p.title)}</h3>
          <p class="cab-my-card__meta">${esc([p.countryName, p.location, p.type, p.area ? p.area + ' м²' : ''].filter(Boolean).join(' · '))}</p>
          <div class="cab-my-card__actions">
            <button type="button" data-edit-prop="${esc(p.id)}">Редактировать</button>
            <button type="button" data-ask-my="${esc(p.id)}">Спросить ИИ</button>
            <button type="button" class="is-danger" data-del-prop="${esc(p.id)}">Удалить</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  /* ---------- РЕДАКТОР ОБЪЕКТА + СЖАТИЕ И ЗАГРУЗКА ФОТО ---------- */
  function updateLivePreview() {
    const title = $('#pTitle').value.trim() || 'Название вашего объекта';
    const type = $('#pType').value || 'Квартира';
    const cSel = $('#pCountry');
    const cName = cSel.value === 'other'
      ? ($('#pCountryCustom').value.trim() || 'Другая страна')
      : cSel.options[cSel.selectedIndex].textContent;
    const city = $('#pCity').value.trim() || 'Город';
    const district = $('#pDistrict').value.trim();
    const rawPrice = Number($('#pPrice').value) || 0;
    const currency = $('#pCurrency').value || 'USD';
    const area = Number($('#pArea').value) || 0;
    const beds = $('#pBeds').value;
    const usdVal = rawPrice ? Math.round(rawPrice * (RATES_TO_USD[currency] || 1)) : 0;
    const ppm = (editorDeal === 'sale' && usdVal && area) ? Math.round(usdVal / area) : 0;
    const cover = editorPhotos[0] || '../assets/hero-phuket.jpg';

    const priceHtml = usdVal
      ? (editorDeal === 'rent' ? `$${nsep(usdVal)} <small>/ мес</small>` : `$${nsep(usdVal)}`)
      : 'Укажите цену';
    const meta = [district ? `${district}, ${city}` : city, cName, beds ? `${beds} сп.` : '', area ? `${area} м²` : ''].filter(Boolean).join(' · ');

    $('#pLivePreview').innerHTML = `<article class="card">
      <div class="card__media">
        <img src="${esc(cover)}" alt="" onerror="this.onerror=null;this.src='../assets/hero-phuket.jpg'"/>
        <div class="card__badges">
          <span class="card__tag">${esc(type)}</span>
          <span class="badge badge--owner">От собственника</span>
          ${editorDeal === 'rent' ? '<span class="badge badge--rent">Аренда</span>' : ''}
        </div>
      </div>
      <div class="card__body">
        <span class="card__price">${priceHtml}</span>
        <h3>${esc(title)}</h3>
        <p class="card__meta">${esc(meta)}</p>
        <div class="card__bottom">
          <span class="card__ppm">${ppm ? `≈ $${nsep(ppm)}/м²` : ''}</span>
          <span class="card__link">Предпросмотр</span>
        </div>
      </div>
    </article>`;
  }

  function renderPhotosGrid() {
    $('#pPhotosGrid').innerHTML = editorPhotos.map((u, idx) => `
      <div class="cab-photo-item">
        <img src="${esc(u)}" alt="Фото ${idx + 1}" />
        ${idx === 0
          ? '<span class="cab-photo-item__cover">Обложка</span>'
          : `<button type="button" class="cab-photo-item__cover" data-cover-idx="${idx}">Сделать обложкой</button>`}
        <button type="button" class="cab-photo-item__del" data-del-photo="${idx}" aria-label="Удалить фото">×</button>
      </div>
    `).join('');
    updateLivePreview();
  }

  async function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Файл не является изображением'));
        img.onload = () => {
          const maxSide = 1400;
          let w = img.width, h = img.height;
          if (w > maxSide || h > maxSide) {
            if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
            else { w = Math.round(w * maxSide / h); h = maxSide; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhotoFiles(files) {
    const hint = $('#pPhotoHint');
    const list = Array.from(files || []).slice(0, Math.max(0, 8 - editorPhotos.length));
    if (!list.length) return;
    showHint(hint, 'Загружаем и оптимизируем фото…');
    for (const file of list) {
      try {
        const dataUrl = await compressPhoto(file);
        const res = await apiFetch('/api/cabinet/photos', {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        });
        if (res.ok && res.data.url) {
          editorPhotos.push(res.data.url);
          renderPhotosGrid();
        } else {
          showHint(hint, (res.data && res.data.message) || 'Не удалось загрузить фото.', 'err');
        }
      } catch (err) {
        showHint(hint, err.message || 'Ошибка обработки фото.', 'err');
      }
    }
    if (editorPhotos.length) showHint(hint, `Загружено фото: ${editorPhotos.length}`, 'ok');
  }

  function ensureMiniMap() {
    if (typeof L === 'undefined') return;
    const el = $('#pMiniMap');
    if (!el) return;
    const lat = parseFloat($('#pLat').value) || 7.8804;
    const lng = parseFloat($('#pLng').value) || 98.3923;
    if (!miniMap) {
      miniMap = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 11);
      if (window.Basemap) window.Basemap.attach(miniMap, { maxZoom: 18 });
      miniMap.on('click', (e) => {
        $('#pLat').value = e.latlng.lat.toFixed(6);
        $('#pLng').value = e.latlng.lng.toFixed(6);
        if (miniMarker) miniMarker.setLatLng(e.latlng);
        else miniMarker = L.marker(e.latlng).addTo(miniMap);
      });
    }
    if ($('#pLat').value && $('#pLng').value) {
      if (miniMarker) miniMarker.setLatLng([lat, lng]);
      else miniMarker = L.marker([lat, lng]).addTo(miniMap);
    }
    setTimeout(() => miniMap && miniMap.invalidateSize(), 150);
  }

  function resetPropForm() {
    $('#propEditId').value = '';
    $('#propFormTitle').textContent = 'Новый объект недвижимости';
    $('#propCancelEdit').hidden = true;
    $('#propForm').reset();
    editorDeal = 'sale';
    document.querySelectorAll('.cab-deal-switch button').forEach(b => b.classList.toggle('is-active', b.dataset.deal === 'sale'));
    $('#pPriceLabel').textContent = 'Цена продажи *';
    $('#pCountryCustomWrap').hidden = true;
    editorPhotos = [];
    editorFeatures.clear();
    document.querySelectorAll('#pFeatureChips .chip').forEach(c => c.classList.remove('is-active'));
    if (currentGeo && currentGeo.country && $('#pCountry option[value="' + currentGeo.country + '"]')) {
      $('#pCountry').value = currentGeo.country;
    }
    if (currentGeo && currentGeo.city && !$('#pCity').value) {
      $('#pCity').value = currentGeo.city;
    }
    renderPhotosGrid();
    showHint($('#pFormHint'), '');
  }

  function fillPropForm(p) {
    $('#propEditId').value = p.id;
    $('#propFormTitle').textContent = 'Редактирование объекта';
    $('#propCancelEdit').hidden = false;
    editorDeal = p.deal === 'rent' ? 'rent' : 'sale';
    document.querySelectorAll('.cab-deal-switch button').forEach(b => b.classList.toggle('is-active', b.dataset.deal === editorDeal));
    $('#pPriceLabel').textContent = editorDeal === 'rent' ? 'Аренда в месяц *' : 'Цена продажи *';
    $('#pTitle').value = p.title || '';
    $('#pType').value = p.type || 'Квартира';
    if ($('#pCountry option[value="' + p.country + '"]')) {
      $('#pCountry').value = p.country;
      $('#pCountryCustomWrap').hidden = true;
    } else {
      $('#pCountry').value = 'other';
      $('#pCountryCustomWrap').hidden = false;
      $('#pCountryCustom').value = p.countryName || '';
    }
    $('#pCity').value = p.city || '';
    $('#pDistrict').value = p.district || '';
    $('#pPrice').value = p.priceRaw || p.priceUSD || p.rentMonthUSD || '';
    $('#pCurrency').value = p.currency || 'USD';
    $('#pArea').value = p.area || '';
    $('#pBeds').value = p.beds != null ? String(p.beds) : '2';
    $('#pBaths').value = p.baths != null ? String(p.baths) : '2';
    $('#pFloor').value = p.floor != null ? String(p.floor) : '';
    $('#pBeach').value = p.beach || '';
    $('#pDesc').value = p.description || '';
    $('#pLat').value = p.lat != null ? String(p.lat) : '';
    $('#pLng').value = p.lng != null ? String(p.lng) : '';
    $('#pOwnerContact').value = p.ownerContact || '';

    editorFeatures = new Set(Array.isArray(p.features) ? p.features : []);
    document.querySelectorAll('#pFeatureChips .chip').forEach(c => {
      c.classList.toggle('is-active', editorFeatures.has(c.dataset.feat));
    });
    editorPhotos = Array.isArray(p.images) ? p.images.slice() : (p.image ? [p.image] : []);
    renderPhotosGrid();
    openTab('add');
  }

  document.querySelectorAll('.cab-deal-switch button').forEach(b => {
    b.addEventListener('click', () => {
      editorDeal = b.dataset.deal;
      document.querySelectorAll('.cab-deal-switch button').forEach(x => x.classList.toggle('is-active', x === b));
      $('#pPriceLabel').textContent = editorDeal === 'rent' ? 'Аренда в месяц *' : 'Цена продажи *';
      updateLivePreview();
    });
  });

  $('#pCountry').addEventListener('change', () => {
    $('#pCountryCustomWrap').hidden = $('#pCountry').value !== 'other';
    updateLivePreview();
  });

  $('#pCity').addEventListener('change', () => {
    const coords = CITY_COORDS[$('#pCity').value.trim()];
    if (coords && miniMap) miniMap.setView(coords, 11);
  });

  $('#pMapDetails').addEventListener('toggle', () => {
    if ($('#pMapDetails').open) ensureMiniMap();
  });

  ['#pTitle', '#pType', '#pCountryCustom', '#pCity', '#pDistrict', '#pPrice', '#pCurrency', '#pArea', '#pBeds'].forEach(sel => {
    const el = $(sel);
    el && el.addEventListener('input', updateLivePreview);
  });

  $('#pFeatureChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const f = chip.dataset.feat;
    if (editorFeatures.has(f)) editorFeatures.delete(f);
    else editorFeatures.add(f);
    chip.classList.toggle('is-active', editorFeatures.has(f));
  });

  $('#pPhotoPickBtn').addEventListener('click', () => $('#pPhotoInput').click());
  $('#pPhotoInput').addEventListener('change', (e) => uploadPhotoFiles(e.target.files));
  const dz = $('#pDropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('is-drag');
    if (e.dataTransfer && e.dataTransfer.files) uploadPhotoFiles(e.dataTransfer.files);
  });

  $('#pPhotoUrlBtn').addEventListener('click', () => {
    const u = $('#pPhotoUrl').value.trim();
    if (!/^https?:\/\/.+/i.test(u)) return showHint($('#pPhotoHint'), 'Укажите корректную ссылку https://…', 'err');
    if (editorPhotos.length >= 8) return showHint($('#pPhotoHint'), 'Максимум 8 фотографий.', 'err');
    editorPhotos.push(u);
    $('#pPhotoUrl').value = '';
    renderPhotosGrid();
  });

  $('#pPhotosGrid').addEventListener('click', (e) => {
    const cover = e.target.closest('[data-cover-idx]');
    if (cover) {
      const i = parseInt(cover.dataset.coverIdx, 10);
      const picked = editorPhotos.splice(i, 1)[0];
      if (picked) editorPhotos.unshift(picked);
      renderPhotosGrid();
      return;
    }
    const del = e.target.closest('[data-del-photo]');
    if (del) {
      editorPhotos.splice(parseInt(del.dataset.delPhoto, 10), 1);
      renderPhotosGrid();
    }
  });

  $('#propCancelEdit').addEventListener('click', () => resetPropForm());

  async function submitProperty(asDraft) {
    const hint = $('#pFormHint');
    const title = $('#pTitle').value.trim();
    const city = $('#pCity').value.trim();
    const price = Number($('#pPrice').value);
    if (title.length < 3) return showHint(hint, 'Укажите название объекта или ЖК.', 'err');
    if (!city) return showHint(hint, 'Укажите город.', 'err');
    if (!Number.isFinite(price) || price <= 0) return showHint(hint, 'Укажите цену больше 0.', 'err');

    const cCode = $('#pCountry').value;
    const cName = cCode === 'other'
      ? $('#pCountryCustom').value.trim()
      : $('#pCountry').options[$('#pCountry').selectedIndex].textContent;
    if (cCode === 'other' && !cName) return showHint(hint, 'Укажите название страны.', 'err');

    const payload = {
      deal: editorDeal,
      title,
      type: $('#pType').value,
      country: cCode,
      countryName: cName,
      city,
      district: $('#pDistrict').value.trim(),
      price,
      currency: $('#pCurrency').value,
      area: $('#pArea').value ? Number($('#pArea').value) : undefined,
      beds: $('#pBeds').value,
      baths: $('#pBaths').value ? Number($('#pBaths').value) : undefined,
      floor: $('#pFloor').value ? Number($('#pFloor').value) : undefined,
      beach: $('#pBeach').value.trim(),
      description: $('#pDesc').value.trim(),
      features: Array.from(editorFeatures),
      images: editorPhotos.slice(),
      image: editorPhotos[0] || '',
      lat: $('#pLat').value.trim() || undefined,
      lng: $('#pLng').value.trim() || undefined,
      ownerContact: $('#pOwnerContact').value.trim(),
      draft: !!asDraft,
    };

    const editId = $('#propEditId').value;
    const btn = $('#pSubmitPublish');
    btn.disabled = true;
    showHint(hint, asDraft ? 'Сохраняем черновик…' : 'Отправляем объект команде на проверку…');

    const res = await apiFetch(editId ? `/api/cabinet/listings/${encodeURIComponent(editId)}` : '/api/cabinet/listings', {
      method: editId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    }).catch(() => ({ ok: false, data: { message: 'Ошибка сети.' } }));

    btn.disabled = false;
    if (!res.ok) {
      return showHint(hint, (res.data && res.data.message) || 'Не удалось сохранить объект.', 'err');
    }

    const mineRes = await apiFetch('/api/cabinet/listings');
    if (mineRes.ok && Array.isArray(mineRes.data.items)) myListings = mineRes.data.items;
    renderMyObjects();
    resetPropForm();
    openTab('my-objects');
  }

  $('#propForm').addEventListener('submit', (e) => { e.preventDefault(); submitProperty(false); });
  $('#pSaveDraft').addEventListener('click', () => submitProperty(true));

  /* ---------- ДЕЙСТВИЯ В МОИХ ОБЪЕКТАХ, ПОДБОРКЕ И ИЗБРАННОМ ---------- */
  document.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-prop]');
    if (editBtn) {
      const p = myListings.find(x => x.id === editBtn.dataset.editProp);
      if (p) fillPropForm(p);
      return;
    }
    const delBtn = e.target.closest('[data-del-prop]');
    if (delBtn) {
      if (!confirm('Удалить этот объект из кабинета?')) return;
      const id = delBtn.dataset.delProp;
      const res = await apiFetch(`/api/cabinet/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        myListings = myListings.filter(x => x.id !== id);
        renderMyObjects();
      }
      return;
    }
    const askMy = e.target.closest('[data-ask-my]');
    if (askMy && window.EstateChat) {
      const p = myListings.find(x => x.id === askMy.dataset.askMy);
      if (p) window.EstateChat.askAbout(p);
      return;
    }
    const askList = e.target.closest('[data-ask-listing]');
    if (askList && window.EstateChat) {
      const it = allCatalog.find(x => String(x.id) === String(askList.dataset.askListing));
      if (it) window.EstateChat.askAbout(it);
      return;
    }
    const unfav = e.target.closest('[data-unfav]');
    if (unfav) {
      const id = String(unfav.dataset.unfav);
      const favs = new Set((store.get(KEY_FAV, []) || []).map(String));
      favs.delete(id);
      const arr = Array.from(favs);
      store.set(KEY_FAV, arr);
      if (currentUser) {
        currentUser.favorites = arr;
        store.set(KEY_USER, currentUser);
        apiFetch('/api/cabinet/profile', { method: 'PUT', body: JSON.stringify({ favorites: arr }) }).catch(() => {});
      }
      renderFavorites();
    }
  });

  /* ---------- ПРОФИЛЬ ---------- */
  function fillProfileForm() {
    if (!currentUser) return;
    $('#profName').value = currentUser.name || '';
    $('#profContact').value = currentUser.contact || currentUser.login || '';
    if ($('#profEmail')) $('#profEmail').value = currentUser.email || '';
    if ($('#profPhone')) $('#profPhone').value = currentUser.phone || '';
    if ($('#profTelegram')) $('#profTelegram').value = currentUser.telegram || '';
    if ($('#profCompany')) $('#profCompany').value = currentUser.company || '';
    $('#profRole').value = currentUser.role || 'buyer';
    $('#profCurrency').value = currentUser.currency || 'USD';
    const ob = currentUser.onboarding || store.get(KEY_ONBOARD, null) || {};
    $('#profGoal').value = ob.goal || '';
    $('#profRegion').value = ob.country || '';
    $('#profType').value = ob.type || '';
    $('#profBudget').value = ob.budget || '';
  }

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const hint = $('#profHint');
    const name = $('#profName').value.trim();
    const contact = $('#profContact').value.trim();
    if (name.length < 2 || !contact) return showHint(hint, 'Заполните имя и контакт.', 'err');

    const onboarding = {
      goal: $('#profGoal').value,
      country: $('#profRegion').value,
      type: $('#profType').value,
      budget: $('#profBudget').value,
      updatedAt: new Date().toISOString(),
    };
    const res = await apiFetch('/api/cabinet/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name,
        contact,
        email: $('#profEmail') ? $('#profEmail').value.trim() : undefined,
        phone: $('#profPhone') ? $('#profPhone').value.trim() : undefined,
        telegram: $('#profTelegram') ? $('#profTelegram').value.trim() : undefined,
        company: $('#profCompany') ? $('#profCompany').value.trim() : undefined,
        role: $('#profRole').value,
        currency: $('#profCurrency').value,
        onboarding,
        geo: currentGeo,
      }),
    });
    if (!res.ok) return showHint(hint, 'Не удалось сохранить профиль.', 'err');

    syncLocalAuth(token, res.data.user);
    store.set('ae_currency', res.data.user.currency);
    renderWelcome();
    renderForYou();
    showHint(hint, 'Профиль и настройки подбора сохранены.', 'ok');
  });

  /* ---------- ЧАТ С ИИ ИЗ КАБИНЕТА ---------- */
  $('#dashAskAiBtn').addEventListener('click', () => {
    if (window.EstateChat) window.EstateChat.open();
  });
  $('#forYouAskAi').addEventListener('click', () => {
    if (window.EstateChat) {
      window.EstateChat.openWithPrompt('Подскажите, пожалуйста, какие объекты лучше подойдут под мои параметры подбора и регион?');
    }
  });

  /* ---------- ЗАПУСК ДАШБОРДА ---------- */
  function renderWelcome() {
    if (!currentUser) return;
    $('#dashRoleLabel').textContent = ROLE_LABELS[currentUser.role] || 'Личный кабинет';
    $('#dashGreeting').textContent = `Здравствуйте, ${currentUser.name}`;
    const meta = [currentUser.contact || currentUser.login];
    if (currentGeo && (currentGeo.city || currentGeo.countryName)) {
      meta.push('регион входа: ' + [currentGeo.city, currentGeo.countryName].filter(Boolean).join(', '));
    }
    $('#dashMeta').textContent = meta.filter(Boolean).join(' · ');
  }

  async function bootDashboard() {
    authView.hidden = true;
    dashView.hidden = false;
    logoutBtn.hidden = false;
    renderWelcome();
    fillProfileForm();

    const [mineRes] = await Promise.all([
      apiFetch('/api/cabinet/listings').catch(() => ({ ok: false })),
      loadCatalog(),
    ]);
    if (mineRes.ok && Array.isArray(mineRes.data.items)) myListings = mineRes.data.items;
    renderMyObjects();
    renderForYou();
    renderFavorites();
    resetPropForm();

    const hash = location.hash.slice(1);
    if (['for-you', 'my-objects', 'add', 'favorites', 'profile'].includes(hash)) {
      openTab(hash);
    } else if (currentUser && (currentUser.role === 'owner' || currentUser.role === 'partner') && !myListings.length) {
      openTab('my-objects');
    } else {
      openTab('for-you');
    }
  }

  async function init() {
    await loadGeo();
    if (token) {
      const me = await apiFetch('/api/cabinet/me').catch(() => ({ ok: false }));
      if (me.ok && me.data && me.data.user) {
        syncLocalAuth(token, me.data.user);
        await bootDashboard();
        return;
      }
      if (me.status === 401) syncLocalAuth('', null);
    }
    authView.hidden = false;
    dashView.hidden = true;
    logoutBtn.hidden = true;
  }

  init();
})();
