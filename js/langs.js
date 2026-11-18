/* ============================================================
   Estate Art — языки сайта: список, флаги, автоопределение,
   выпадающее меню выбора. Общий модуль для главной и блога.

   Порядок выбора языка при входе:
   1) ?lang=xx в адресе (ссылки из рекламы и рассылок);
   2) язык, который человек выбрал сам (localStorage ae_lang);
   3) язык Telegram, если сайт открыт как мини-апп;
   4) языки браузера по порядку предпочтения;
   5) английский для всех остальных.
   Автоопределённый язык не запоминается: запоминается только
   выбор, сделанный руками.
   ============================================================ */
(function () {
  'use strict';

  var STORE = 'ae_lang';

  /* Флаги — SVG, а не эмодзи: Windows рисует эмодзи-флаги буквами «RU». */
  function star(cx, cy, r, rot) {
    var p = [], a0 = -Math.PI / 2 + (rot || 0);
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? r * 0.382 : r, a = a0 + i * Math.PI / 5;
      p.push((cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2));
    }
    return '<polygon fill="#ffde00" points="' + p.join(' ') + '"/>';
  }
  function smallCross(x, y) {
    return '<path d="M' + (x - 2) + ' ' + y + 'h4M' + x + ' ' + (y - 2) + 'v4" stroke="#e8112d" stroke-width="1.3"/>';
  }
  var FLAGS = {
    ru: '<svg viewBox="0 0 9 6"><rect width="9" height="6" fill="#fff"/><rect y="2" width="9" height="2" fill="#0039a6"/><rect y="4" width="9" height="2" fill="#d52b1e"/></svg>',
    en: '<svg viewBox="0 0 60 30"><rect width="60" height="30" fill="#012169"/><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>',
    th: '<svg viewBox="0 0 9 6"><rect width="9" height="6" fill="#a51931"/><rect y="1" width="9" height="4" fill="#f4f5f8"/><rect y="2" width="9" height="2" fill="#2d2a4a"/></svg>',
    vi: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#da251d"/>' + star(15, 10.6, 6) + '</svg>',
    zh: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#de2910"/>' + star(5, 5, 3) +
        star(10, 2, 1, .9) + star(12, 4, 1, 1.4) + star(12, 7, 1, 2) + star(10, 9, 1, 2.6) + '</svg>',
    ar: '<svg viewBox="0 0 12 6"><rect width="12" height="2" fill="#00732f"/><rect y="2" width="12" height="2" fill="#fff"/><rect y="4" width="12" height="2" fill="#000"/><rect width="3" height="6" fill="#ff0000"/></svg>',
    id: '<svg viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><rect width="3" height="1" fill="#ce1126"/></svg>',
    ka: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><path d="M15 0v20M0 10h30" stroke="#e8112d" stroke-width="4"/>' +
        smallCross(7, 5) + smallCross(23, 5) + smallCross(7, 15) + smallCross(23, 15) + '</svg>',
  };

  /* name — самоназвание языка: человек ищет в списке свой язык, а не перевод его названия.
     pack — словарь лежит отдельным файлом и грузится, только когда язык выбран. */
  var LIST = [
    { code: 'ru', name: 'Русский',          bcp: 'ru-RU' },
    { code: 'en', name: 'English',          bcp: 'en-US' },
    { code: 'th', name: 'ไทย',              bcp: 'th-TH' },
    { code: 'vi', name: 'Tiếng Việt',       bcp: 'vi-VN', pack: true },
    { code: 'zh', name: '中文',              bcp: 'zh-CN', pack: true },
    { code: 'ar', name: 'العربية',          bcp: 'ar-AE', pack: true, rtl: true },
    { code: 'id', name: 'Bahasa Indonesia', bcp: 'id-ID', pack: true },
    { code: 'ka', name: 'ქართული',          bcp: 'ka-GE', pack: true },
  ];
  var BY = {};
  LIST.forEach(function (l) { BY[l.code] = l; });

  /* Языки, носители которых почти всегда читают по-русски свободнее, чем по-английски. */
  var RU_LIKE = ['uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'tk', 'mo'];
  var ALIAS = { ms: 'id', in: 'id' }; // малайский близок к индонезийскому; «in» — старый код id

  function norm(tag) {
    if (!tag) return null;
    var base = String(tag).toLowerCase().split(/[-_]/)[0];
    base = ALIAS[base] || base;
    if (BY[base]) return base;
    if (RU_LIKE.indexOf(base) !== -1) return 'ru';
    return null;
  }

  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  var packBase = scriptSrc ? scriptSrc.replace(/langs\.js(\?.*)?$/, 'i18n/') : 'js/i18n/';
  var ver = (scriptSrc.match(/\?v=([^&]+)/) || [])[1] || '';

  function fromUrl() {
    try { return norm(new URLSearchParams(location.search).get('lang')); } catch (e) { return null; }
  }
  function saved() {
    try { var s = localStorage.getItem(STORE); return BY[s] ? s : null; } catch (e) { return null; }
  }
  function fromTelegram() {
    try {
      var u = window.Telegram.WebApp.initDataUnsafe.user;
      return u && norm(u.language_code);
    } catch (e) { return null; }
  }
  function fromBrowser() {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    for (var i = 0; i < list.length; i++) { var c = norm(list[i]); if (c) return c; }
    return list[0] ? 'en' : 'ru';
  }

  function initial() {
    var u = fromUrl();
    if (u) { remember(u); return u; }
    return saved() || fromTelegram() || fromBrowser();
  }
  function remember(code) { try { localStorage.setItem(STORE, code); } catch (e) {} }

  var loading = {};
  function loadPack(code) {
    var l = BY[code];
    if (!l || !l.pack) return Promise.resolve(null);
    var packs = window.AE_LANG_PACKS || {};
    if (packs[code]) return Promise.resolve(packs[code]);
    if (loading[code]) return loading[code];
    loading[code] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = packBase + code + '.js' + (ver ? '?v=' + ver : '');
      s.onload = function () { resolve((window.AE_LANG_PACKS || {})[code] || null); };
      s.onerror = function () { delete loading[code]; resolve(null); };
      document.head.appendChild(s);
    });
    return loading[code];
  }

  /* <html lang dir>: от dir зависит направление всей вёрстки для арабского. */
  function setDocument(code) {
    var root = document.documentElement;
    root.lang = code;
    root.dir = BY[code] && BY[code].rtl ? 'rtl' : 'ltr';
  }

  function flag(code) { return '<span class="flag" aria-hidden="true">' + (FLAGS[code] || '').replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ') + '</span>'; }

  /* ---------- Меню выбора языка в шапке ---------- */
  var menus = [];
  function mount(host, opts) {
    if (!host) return null;
    var cur = opts.current;
    var wrap = document.createElement('div');
    wrap.className = 'lang-menu' + (opts.className ? ' ' + opts.className : '');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-menu__btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var list = document.createElement('ul');
    list.className = 'lang-menu__list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    var listId = 'langList' + menus.length;
    list.id = listId;
    btn.setAttribute('aria-controls', listId);
    LIST.forEach(function (l) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.lang = l.code;
      li.lang = l.code;
      // Строки идут по направлению страницы, а само название — по своему письму
      li.innerHTML = flag(l.code) + '<span class="lang-menu__name" dir="' + (l.rtl ? 'rtl' : 'ltr') + '">' + l.name + '</span>';
      list.appendChild(li);
    });
    wrap.appendChild(btn); wrap.appendChild(list);
    host.appendChild(wrap);

    function paint() {
      var l = BY[cur];
      btn.innerHTML = flag(cur) + '<span class="lang-menu__code">' + cur.toUpperCase() + '</span>' +
        '<svg class="lang-menu__chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      btn.setAttribute('aria-label', 'Language: ' + l.name);
      list.querySelectorAll('[role=option]').forEach(function (o) {
        o.setAttribute('aria-selected', o.dataset.lang === cur ? 'true' : 'false');
      });
    }
    function items() { return Array.prototype.slice.call(list.querySelectorAll('[role=option]')); }
    function open() {
      menus.forEach(function (m) { if (m !== api) m.close(); });
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      var sel = list.querySelector('[aria-selected=true]') || items()[0];
      sel.focus({ preventScroll: true });
    }
    function close(focusBtn) {
      if (list.hidden) return;
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      if (focusBtn) btn.focus({ preventScroll: true });
    }
    function choose(code) {
      close(true);
      if (code !== cur) opts.onChange(code);
    }
    btn.addEventListener('click', function () { list.hidden ? open() : close(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    });
    list.addEventListener('click', function (e) {
      var o = e.target.closest('[role=option]');
      if (o) choose(o.dataset.lang);
    });
    list.addEventListener('keydown', function (e) {
      var all = items(), i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); all[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); all[all.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(all[i].dataset.lang); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close();
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });

    var api = {
      set: function (code) { cur = code; paint(); },
      close: close,
    };
    paint();
    menus.push(api);
    return api;
  }

  window.AELangs = {
    list: LIST,
    get: function (code) { return BY[code] || null; },
    flag: flag,
    initial: initial,
    remember: remember,
    loadPack: loadPack,
    setDocument: setDocument,
    mount: mount,
    syncMenus: function (code) { menus.forEach(function (m) { m.set(code); }); },
  };
})();
