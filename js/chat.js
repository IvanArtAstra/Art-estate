/* ============================================================
   Estate Art — чат на сайте, связанный с Telegram через воркер.

   Виджет появляется только если в <body> задан data-chat-endpoint.
   Пока адрес не прописан, сайт работает ровно как раньше.
   Настройка моста — в bot/README.md.
   ============================================================ */
(function () {
  'use strict';

  const endpoint = (document.body.dataset.chatEndpoint || '').replace(/\/+$/, '');
  if (!endpoint) return;

  const POLL_OPEN = 4000;       // как часто спрашиваем воркер при открытом чате
  const POLL_IDLE = 20000;      // и в фоне, чтобы показать непрочитанное
  const KEY_SESSION = 'ae_chat_session';
  const KEY_LOG = 'ae_chat_log';
  const KEY_WHO = 'ae_chat_who';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  function sessionId() {
    let id = store.get(KEY_SESSION, null);
    if (!id) {
      const rnd = crypto.getRandomValues(new Uint8Array(9));
      id = Array.from(rnd, b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
      store.set(KEY_SESSION, id);
    }
    return id;
  }

  let log = store.get(KEY_LOG, []);
  let who = store.get(KEY_WHO, null);   // {name, contact} — спрашиваем один раз
  let lastId = log.reduce((m, x) => Math.max(m, x.id || 0), 0);
  let open = false;
  let timer = null;
  let unread = 0;

  /* ---------- разметка ---------- */
  const ICON_CHAT = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>';

  const root = document.createElement('div');
  root.className = 'chat';
  root.innerHTML = `
    <button class="chat__fab" type="button" aria-label="Открыть чат" aria-expanded="false">
      ${ICON_CHAT}<span class="chat__badge" hidden>0</span>
    </button>
    <section class="chat__panel" hidden aria-label="Чат с агентом">
      <header class="chat__head">
        <span class="chat__who"><b>Estate Art</b><span>Отвечаем в рабочее время Пхукета</span></span>
        <button class="chat__close" type="button" aria-label="Свернуть чат">${ICON_CLOSE}</button>
      </header>
      <div class="chat__log" role="log" aria-live="polite"></div>
      <form class="chat__form" novalidate>
        <div class="chat__intro" hidden>
          <label><span>Как вас зовут</span><input type="text" class="chat__name" autocomplete="name" /></label>
          <label><span>Телефон или @telegram, если ответить не сюда</span><input type="text" class="chat__contact" autocomplete="tel" /></label>
          <label class="chat__consent">
            <input type="checkbox" class="chat__agree" />
            <span>Согласен на обработку персональных данных и принимаю <a href="privacy/" target="_blank" rel="noopener">политику конфиденциальности</a></span>
          </label>
        </div>
        <div class="chat__row">
          <textarea class="chat__input" rows="1" placeholder="Напишите вопрос…" maxlength="2000"></textarea>
          <button class="chat__send" type="submit" aria-label="Отправить">${ICON_SEND}</button>
        </div>
        <p class="chat__hint" aria-live="polite"></p>
      </form>
    </section>`;
  document.body.appendChild(root);
  document.body.classList.add('has-chat');

  const fab = $('.chat__fab', root);
  const panel = $('.chat__panel', root);
  const logEl = $('.chat__log', root);
  const form = $('.chat__form', root);
  const intro = $('.chat__intro', root);
  const nameEl = $('.chat__name', root);
  const contactEl = $('.chat__contact', root);
  const agreeEl = $('.chat__agree', root);
  const input = $('.chat__input', root);
  const sendBtn = $('.chat__send', root);
  const hint = $('.chat__hint', root);
  const badge = $('.chat__badge', root);

  /* ---------- отрисовка ---------- */
  function time(iso) {
    try { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function render() {
    if (!log.length) {
      logEl.innerHTML = `<p class="chat__empty">Здравствуйте! Спросите про объект, район или переезд —
        отвечаем лично, без ботов-автоответчиков.</p>`;
      return;
    }
    logEl.innerHTML = log.map(m => `
      <div class="chat__msg chat__msg--${m.from === 'agent' ? 'agent' : 'user'}">
        <p>${esc(m.text)}</p>
        <time>${esc(time(m.at))}${m.pending ? ' · отправляется' : ''}${m.failed ? ' · не ушло' : ''}</time>
      </div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
  function save() { store.set(KEY_LOG, log.slice(-60)); }

  function setUnread(n) {
    unread = n;
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    fab.classList.toggle('has-unread', !!n);
  }

  /* ---------- сеть ---------- */
  async function poll() {
    try {
      const r = await fetch(`${endpoint}/api/poll?s=${encodeURIComponent(sessionId())}&after=${lastId}`, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const fresh = (data.messages || []).filter(m => m.from === 'agent');
      if (fresh.length) {
        fresh.forEach(m => { log.push(m); lastId = Math.max(lastId, m.id); });
        save(); render();
        if (!open) setUnread(unread + fresh.length);
      }
      if (data.last) lastId = Math.max(lastId, data.last);
    } catch (e) { /* сеть моргнула — попробуем на следующем круге */ }
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(poll, open ? POLL_OPEN : POLL_IDLE);
  }

  async function send(text) {
    const local = { id: ++lastId, from: 'user', text, at: new Date().toISOString(), pending: true };
    log.push(local); save(); render();
    try {
      const r = await fetch(`${endpoint}/api/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId(), text,
          name: who && who.name, contact: who && who.contact,
          page: document.title,
        }),
      });
      const data = await r.json().catch(() => ({}));
      delete local.pending;
      if (!r.ok || !data.ok) {
        local.failed = true;
        hint.textContent = data.message || 'Сообщение не ушло. Попробуйте ещё раз или напишите в WhatsApp.';
        hint.className = 'chat__hint chat__hint--err';
      } else {
        hint.textContent = '';
      }
    } catch (e) {
      delete local.pending;
      local.failed = true;
      hint.textContent = 'Нет связи. Проверьте интернет или напишите в WhatsApp.';
      hint.className = 'chat__hint chat__hint--err';
    }
    save(); render();
  }

  /* ---------- поведение ---------- */
  function toggle(next) {
    open = next;
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? 'Свернуть чат' : 'Открыть чат');
    root.classList.toggle('is-open', open);
    if (open) {
      setUnread(0);
      intro.hidden = !!who;
      render();
      setTimeout(() => (who ? input : nameEl).focus(), 120);
      poll();
    }
    schedule();
  }

  fab.addEventListener('click', () => toggle(!open));
  $('.chat__close', root).addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) toggle(false); });

  // Enter отправляет, Shift+Enter переносит строку
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    if (!who) {
      if (!agreeEl.checked) {
        hint.textContent = 'Отметьте согласие на обработку персональных данных.';
        hint.className = 'chat__hint chat__hint--err';
        agreeEl.closest('.chat__consent').classList.add('err');
        return;
      }
      who = { name: nameEl.value.trim() || 'Гость', contact: contactEl.value.trim() };
      store.set(KEY_WHO, who);
      intro.hidden = true;
    }
    input.value = '';
    input.style.height = 'auto';
    hint.textContent = '';
    hint.className = 'chat__hint';
    send(text);
  });

  agreeEl.addEventListener('change', () => agreeEl.closest('.chat__consent').classList.remove('err'));

  render();
  schedule();
  poll();
})();
