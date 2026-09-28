/**
 * Estate Art — мост между чатом на сайте и Telegram.
 *
 * Посетитель пишет в виджет на сайте → сообщение приходит агенту в Telegram
 * от имени бота → агент отвечает реплаем на это сообщение → ответ возвращается
 * в виджет на сайте.
 *
 * Токен бота и chat_id агента живут в секретах Cloudflare и в браузер не попадают.
 * Настройка — в bot/README.md.
 */

const MAX_TEXT = 2000;        // длиннее Telegram всё равно порежет
const MAX_NAME = 80;
const SESSION_TTL = 60 * 60 * 24 * 14;   // переписка живёт две недели
const RATE_LIMIT = 20;        // сообщений с одного IP в минуту
const MAX_MESSAGES = 200;     // потолок на сессию, чтобы KV не пух

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const ok = allowed.includes(origin) || (allowed.includes('*') && origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const clean = (v, max) =>
  String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sessionKey = id => `s:${id}`;
const mapKey = msgId => `m:${msgId}`;

async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) console.error('telegram', method, JSON.stringify(data).slice(0, 300));
  return data;
}

async function rateLimited(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.CHAT.get(bucket)) || '0', 10) + 1;
  await env.CHAT.put(bucket, String(n), { expirationTtl: 120 });
  return n > RATE_LIMIT;
}

async function loadSession(env, id) {
  const raw = await env.CHAT.get(sessionKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function saveSession(env, id, session) {
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
  await env.CHAT.put(sessionKey(id), JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

/* ---------- посетитель пишет с сайта ---------- */
async function handleSend(request, env) {
  if (await rateLimited(env, request)) {
    return json({ error: 'too_many_requests', message: 'Слишком много сообщений. Подождите минуту.' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const id = clean(body.sessionId, 40).replace(/[^A-Za-z0-9_-]/g, '');
  const text = clean(body.text, MAX_TEXT);
  if (!id || !text) return json({ error: 'empty' }, 400);

  const name = clean(body.name, MAX_NAME) || 'Гость';
  const contact = clean(body.contact, MAX_NAME);
  const page = clean(body.page, 200);

  let session = await loadSession(env, id);
  const first = !session;
  if (!session) {
    session = { created: new Date().toISOString(), name, contact, page, messages: [] };
  }
  if (name && name !== 'Гость') session.name = name;
  if (contact) session.contact = contact;

  const msg = { id: session.messages.length + 1, from: 'user', text, at: new Date().toISOString() };
  session.messages.push(msg);

  const header = first
    ? `🟢 <b>Новый диалог с сайта</b>\n<b>${esc(session.name)}</b>` +
      (session.contact ? ` · ${esc(session.contact)}` : '') +
      (page ? `\n<i>${esc(page)}</i>` : '')
    : `<b>${esc(session.name)}</b>`;

  const sent = await tg(env, 'sendMessage', {
    chat_id: env.AGENT_CHAT_ID,
    parse_mode: 'HTML',
    text: `${header}\n\n${esc(text)}\n\n<code>#${id}</code>\n<i>Ответьте реплаем на это сообщение — ответ уйдёт на сайт.</i>`,
  });

  // Связываем сообщение в Telegram с сессией: по нему найдём адресата ответа
  if (sent.ok && sent.result && sent.result.message_id) {
    await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
  }

  await saveSession(env, id, session);
  return json({ ok: true, id: msg.id, delivered: !!sent.ok });
}

/* ---------- виджет забирает новые сообщения ---------- */
async function handlePoll(request, env) {
  const url = new URL(request.url);
  const id = clean(url.searchParams.get('s'), 40).replace(/[^A-Za-z0-9_-]/g, '');
  const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
  if (!id) return json({ error: 'no_session' }, 400);

  const session = await loadSession(env, id);
  if (!session) return json({ messages: [], last: 0 });

  const fresh = session.messages.filter(m => m.id > after);
  return json({
    messages: fresh,
    last: session.messages.length ? session.messages[session.messages.length - 1].id : 0,
  });
}

/* ---------- агент отвечает в Telegram ---------- */
async function handleTelegram(request, env) {
  if (env.WEBHOOK_SECRET &&
      request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response('ok'); }

  const message = update.message || update.edited_message;
  if (!message || !message.text) return new Response('ok');

  // Отвечать может только агент — chat_id сверяем с настроенным
  if (String(message.chat.id) !== String(env.AGENT_CHAT_ID)) {
    if (message.text.startsWith('/start')) {
      await tg(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'Это служебный бот Estate Art. Напишите нам через чат на сайте: ' +
              (env.SITE_URL || 'https://ivanartastra.github.io/Art-estate/'),
      });
    }
    return new Response('ok');
  }

  if (message.text.startsWith('/chatid')) {
    await tg(env, 'sendMessage', { chat_id: message.chat.id, text: `chat_id: ${message.chat.id}` });
    return new Response('ok');
  }

  const replyTo = message.reply_to_message;
  if (!replyTo) {
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Чтобы ответить посетителю, сделайте реплай на его сообщение — иначе я не знаю, кому адресовать.',
    });
    return new Response('ok');
  }

  // Ищем сессию: сначала по карте message_id, потом по метке #id в тексте
  let sessionId = await env.CHAT.get(mapKey(replyTo.message_id));
  if (!sessionId) {
    const m = (replyTo.text || '').match(/#([A-Za-z0-9_-]{6,40})/);
    sessionId = m ? m[1] : null;
  }
  if (!sessionId) {
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: 'Не нашёл диалог для этого сообщения — возможно, переписка старше двух недель и уже удалена.',
    });
    return new Response('ok');
  }

  const session = await loadSession(env, sessionId);
  if (!session) {
    await tg(env, 'sendMessage', { chat_id: message.chat.id, text: 'Диалог уже закрыт: посетитель ушёл с сайта давно.' });
    return new Response('ok');
  }

  session.messages.push({
    id: session.messages.length + 1,
    from: 'agent',
    text: clean(message.text, MAX_TEXT),
    at: new Date().toISOString(),
  });
  await saveSession(env, sessionId, session);
  await tg(env, 'setMessageReaction', {
    chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '👌' }],
  });
  return new Response('ok');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/api/health') return json({ ok: true }, 200, cors);

      if (url.pathname === '/api/send' && request.method === 'POST') {
        const res = await handleSend(request, env);
        Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }
      if (url.pathname === '/api/poll' && request.method === 'GET') {
        const res = await handlePoll(request, env);
        Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
        return res;
      }
      if (url.pathname === '/api/telegram' && request.method === 'POST') {
        return await handleTelegram(request, env);
      }
      return new Response('not found', { status: 404 });
    } catch (err) {
      console.error('worker', err && err.stack || err);
      return json({ error: 'internal' }, 500, cors);
    }
  },
};
