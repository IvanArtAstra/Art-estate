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
  const ICON_MIC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
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
          <button class="chat__mic" type="button" hidden aria-label="Нажмите, чтобы продиктовать; удерживайте, чтобы записать голосовое">${ICON_MIC}</button>
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
  const micBtn = $('.chat__mic', root);

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
      const seen = new Set(log.map(m => m.id));
      const fresh = (data.messages || []).filter(m => m.from === 'agent' && !seen.has(m.id));
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
        // Первичный менеджер отвечает в том же запросе — показываем сразу,
        // не дожидаясь следующего опроса: четыре секунды тишины после
        // отправленного сообщения читаются как «не дошло»
        if (data.id) lastId = Math.max(lastId, data.id);
        if (data.reply) {
          // Ответ помощника лежит в сессии следующим номером — забираем его
          // здесь и двигаем счётчик, иначе опрос принесёт то же самое второй раз
          lastId = Math.max(lastId, data.id + 1);
          log.push({ id: data.id + 1, from: 'agent', text: data.reply, at: new Date().toISOString() });
          save(); render();
        }
      }
    } catch (e) {
      delete local.pending;
      local.failed = true;
      hint.textContent = 'Нет связи. Проверьте интернет или напишите в WhatsApp.';
      hint.className = 'chat__hint chat__hint--err';
    }
    save(); render();
  }

  /* Длительность ухода читаем из того же токена, что и остальные слои */
  function exitMs() {
    const v = (getComputedStyle(document.documentElement).getPropertyValue('--t-exit') || '').trim();
    if (/ms$/.test(v)) return parseFloat(v);
    if (/s$/.test(v)) return parseFloat(v) * 1000;
    return 240;
  }

  /* ---------- поведение ---------- */
  let closeTimer = 0;
  function toggle(next) {
    open = next;
    /* Открытие и закрытие теперь одно движение в обе стороны. До этого панель
       входила анимацией, а исчезала установкой hidden в один кадр. */
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    const S = window.Sound;
    if (open) {
      panel.classList.remove('is-closing');
      panel.hidden = false;
      if (S) S.play('open');
    } else if (!panel.hidden) {
      const ms = exitMs();
      panel.classList.add('is-closing');
      closeTimer = setTimeout(() => {
        panel.hidden = true; panel.classList.remove('is-closing'); closeTimer = 0;
      }, ms + 40);
      if (S) S.play('close');
    }
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? 'Свернуть чат' : 'Открыть чат');
    root.classList.toggle('is-open', open);
    if (open) {
      setUnread(0);
      intro.hidden = !!who;
      render();
      panel.addEventListener('animationend', () => { try { (who ? input : nameEl).focus(); } catch (e) {} }, { once: true });
      poll();
    }
    schedule();
  }

  fab.addEventListener('click', () => toggle(!open));
  $('.chat__close', root).addEventListener('click', () => toggle(false));

  /* Кнопка в шапке ведёт в бота ссылкой — это рабочий путь на страницах, где
     виджета нет. Там, где он есть, перехватываем клик и открываем чат здесь:
     разговор начинается на той же странице, без ухода в мессенджер. */
  document.querySelectorAll('[data-chat-open]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); toggle(true); });
  });
  window.EstateChat = { open: () => toggle(true), close: () => toggle(false) };
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

  /* ---------- голос ----------
     Одна кнопка на два действия. Короткое нажатие — диктовка: браузер сам
     распознаёт речь, текст попадает в поле, и дальше это обычное сообщение,
     на которое ИИ отвечает сразу. Удержание — настоящее голосовое: запись
     уходит Алене в Telegram, потому что звук ИИ не слышит.

     Второе работает везде, где есть микрофон. Первое — только там, где есть
     распознавание речи (Safari и Chrome); иначе короткое нажатие тоже
     начинает запись, и кнопка об этом честно говорит. */
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
                       window.MediaRecorder);
  if (Rec || canRecord) {
    micBtn.hidden = false;
    micBtn.setAttribute('aria-label', Rec
      ? 'Нажмите, чтобы продиктовать; удерживайте, чтобы записать голосовое'
      : 'Удерживайте, чтобы записать голосовое');
  }

  function ensureWho() {
    if (who) return true;
    if (!agreeEl.checked) {
      hint.textContent = 'Отметьте согласие на обработку персональных данных.';
      hint.className = 'chat__hint chat__hint--err';
      agreeEl.closest('.chat__consent').classList.add('err');
      return false;
    }
    who = { name: nameEl.value.trim() || 'Гость', contact: contactEl.value.trim() };
    store.set(KEY_WHO, who);
    intro.hidden = true;
    return true;
  }

  function say(text, err) {
    hint.textContent = text;
    hint.className = 'chat__hint' + (err ? ' chat__hint--err' : '');
  }

  /* --- диктовка --- */
  let rec = null;
  function dictate() {
    if (rec) { try { rec.stop(); } catch (e) {} return; }
    rec = new Rec();
    rec.lang = (document.documentElement.lang || 'ru-RU').length > 2
      ? document.documentElement.lang : 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    const base = input.value ? input.value.replace(/\s+$/, '') + ' ' : '';
    rec.onresult = e => {
      let out = '';
      for (let i = e.resultIndex; i < e.results.length; i++) out += e.results[i][0].transcript;
      input.value = base + out;
      input.dispatchEvent(new Event('input'));
    };
    rec.onerror = e => {
      say(e.error === 'not-allowed'
        ? 'Не получили доступ к микрофону. Разрешите его в настройках браузера.'
        : 'Не разобрали речь. Попробуйте ещё раз или напишите текстом.', true);
    };
    rec.onend = () => {
      rec = null;
      micBtn.classList.remove('is-live');
      micBtn.innerHTML = ICON_MIC;
      try { input.focus(); } catch (e) {}
    };
    try {
      rec.start();
      micBtn.classList.add('is-live');
      micBtn.innerHTML = ICON_STOP;
      say('Говорите — текст появится в поле.');
    } catch (e) { rec = null; }
  }

  /* --- голосовое сообщение --- */
  let mediaRec = null, chunks = [], startedAt = 0, tick = 0, cancelled = false;

  function pickMime() {
    const want = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const t of want) {
      if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';   // Safari сам выберет mp4
  }

  async function startRecording() {
    if (mediaRec || !canRecord) return;
    if (!ensureWho()) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      say('Не получили доступ к микрофону. Разрешите его в настройках браузера.', true);
      return;
    }
    const mime = pickMime();
    chunks = []; cancelled = false; startedAt = Date.now();
    mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const secs = Math.round((Date.now() - startedAt) / 1000);
      const blob = new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' });
      mediaRec = null;
      micBtn.classList.remove('is-rec');
      micBtn.innerHTML = ICON_MIC;
      clearInterval(tick);
      if (cancelled) { say(''); return; }
      if (secs < 1 || blob.size < 1200) { say('Слишком коротко — запись не ушла.'); return; }
      sendVoice(blob, secs);
    };
    mediaRec.start();
    micBtn.classList.add('is-rec');
    micBtn.innerHTML = ICON_STOP;
    tick = setInterval(() => {
      const s = Math.round((Date.now() - startedAt) / 1000);
      say('Запись ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') +
          ' — отпустите, чтобы отправить. Esc отменит.');
      if (s >= 60) stopRecording();      // дальше Telegram и так режет
    }, 250);
    say('Запись 0:00 — отпустите, чтобы отправить. Esc отменит.');
  }

  function stopRecording(cancel) {
    if (!mediaRec) return;
    cancelled = !!cancel;
    try { mediaRec.stop(); } catch (e) {}
  }

  async function sendVoice(blob, secs) {
    const local = {
      id: ++lastId, from: 'user', kind: 'voice', at: new Date().toISOString(), pending: true,
      text: '🎤 Голосовое сообщение, ' + secs + ' с',
    };
    log.push(local); save(); render();
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice');
      fd.append('sessionId', sessionId());
      fd.append('seconds', String(secs));
      if (who && who.name) fd.append('name', who.name);
      if (who && who.contact) fd.append('contact', who.contact);
      fd.append('page', document.title);
      const r = await fetch(endpoint + '/api/voice', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      delete local.pending;
      if (!r.ok || !data.ok) {
        local.failed = true;
        // 404 — мост обновлён на сайте, но ещё не на воркере: это не вина гостя
        say(r.status === 404
          ? 'Голосовые пока не включены. Напишите текстом — ответим сразу.'
          : (data.message || 'Запись не ушла. Попробуйте ещё раз или напишите текстом.'), true);
      } else {
        say('Отправили. Алена послушает и ответит сюда же.');
      }
    } catch (e) {
      delete local.pending;
      local.failed = true;
      say('Нет связи. Проверьте интернет или напишите в WhatsApp.', true);
    }
    save(); render();
  }

  /* --- одна кнопка, два жеста --- */
  const HOLD_MS = 350;
  let holdTimer = 0, held = false;

  function pressStart(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    if (mediaRec) return;                 // уже пишем — отпускание остановит
    held = false;
    holdTimer = setTimeout(() => { held = true; startRecording(); }, HOLD_MS);
  }
  function pressEnd() {
    clearTimeout(holdTimer); holdTimer = 0;
    if (mediaRec) { stopRecording(); return; }
    if (held) return;
    if (Rec) dictate();
    else startRecording();                // без распознавания короткое нажатие пишет голос
  }

  micBtn.addEventListener('pointerdown', pressStart);
  micBtn.addEventListener('pointerup', pressEnd);
  micBtn.addEventListener('pointercancel', () => { clearTimeout(holdTimer); stopRecording(true); });
  micBtn.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (mediaRec) { stopRecording(true); e.stopPropagation(); }
    else if (rec) { try { rec.stop(); } catch (err) {} }
  }, true);

  render();
  schedule();
  poll();
})();
