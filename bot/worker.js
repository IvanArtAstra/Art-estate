/**
 * Estate Art — мост между чатом на сайте и Telegram.
 *
 * Посетитель пишет в виджет на сайте → сообщение приходит агенту в Telegram
 * от имени бота → агент отвечает реплаем на это сообщение → ответ возвращается
 * в виджет на сайте.
 *
 * Первым в диалоге отвечает менеджер на Claude (bot/ai.js): доводит разговор до
 * контакта и передаёт живому агенту готовой карточкой. Если ключа Anthropic нет
 * или запрос упал — сообщение уходит дежурному напрямую, как раньше.
 *
 * Токен бота, chat_id агента и ключ Anthropic живут в секретах Cloudflare и в
 * браузер не попадают. Настройка — в bot/README.md.
 */
import { aiReply, leadCard } from './ai.js';
export { AnthropicRelay } from './relay.js';

const MAX_TEXT = 2000;        // длиннее Telegram всё равно порежет
const MAX_NAME = 80;
const SESSION_TTL = 60 * 60 * 24 * 14;   // переписка живёт две недели
const RATE_LIMIT = 20;        // сообщений с одного IP в минуту
const MAX_MESSAGES = 200;     // потолок на сессию, чтобы KV не пух
const AI_TURNS = 12;          // после этого передаём человеку в любом случае
const RANGES_TTL = 60 * 60 * 6;
const MAX_VOICE = 1500000;    // ~60 секунд opus; больше в чат никто не наговаривает

/**
 * Таблица диапазонов цен. Лежит на сайте, собирается tools/price_ranges.py.
 * Держим в KV, чтобы не ходить за ней на каждое сообщение.
 */
async function priceRanges(env) {
  try {
    const cached = await env.CHAT.get('ranges:v1');
    if (cached) return JSON.parse(cached);
    const base = (env.SITE_URL || 'https://estateart.homes/').replace(/\/+$/, '');
    const r = await fetch(base + '/data/price-ranges.json', { cf: { cacheTtl: 3600 } });
    if (!r.ok) return null;
    const data = await r.json();
    await env.CHAT.put('ranges:v1', JSON.stringify(data), { expirationTtl: RANGES_TTL });
    return data;
  } catch (e) {
    console.log('ranges error:', e && e.message);
    return null;   // без таблицы ИИ просто не станет называть цифры
  }
}

/**
 * Дежурные менеджеры. AGENT_CHAT_ID принимает один id или несколько через запятую.
 * Новый диалог уходит следующему по кругу, дальше вся переписка держится за ним —
 * клиент не должен объяснять одно и то же разным людям. Отвечать при этом может
 * любой из списка: если дежурный занят, коллега просто подхватывает.
 */
function managers(env) {
  return String(env.AGENT_CHAT_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

async function assignManager(env, sessionId) {
  const list = managers(env);
  if (list.length <= 1) return list[0] || '';
  const key = 'rr:counter';
  const n = parseInt((await env.CHAT.get(key)) || '0', 10);
  await env.CHAT.put(key, String((n + 1) % 100000));
  return list[n % list.length];
}

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
    session.manager = await assignManager(env, id);
  }
  if (!session.manager) session.manager = await assignManager(env, id);
  if (name && name !== 'Гость') session.name = name;
  if (contact) session.contact = contact;

  const msg = { id: session.messages.length + 1, from: 'user', text, at: new Date().toISOString() };
  session.messages.push(msg);

  /* ---------- первичный менеджер ----------
     Пока он ведёт разговор, дежурным ничего не летит: иначе каждый уточняющий
     вопрос был бы отдельным уведомлением. В Telegram уходит одна карточка —
     когда контакт собран. Любой ответ дежурного реплаем снимает ИИ с диалога. */
  if (!session.handedOff && session.aiTurns !== -1 && (session.aiTurns || 0) < AI_TURNS) {
    const ranges = await priceRanges(env);
    const ai = await aiReply(env, session, null, ranges);   // текст уже в messages
    if (ai && ai.text) {
      session.aiTurns = (session.aiTurns || 0) + 1;
      session.messages.push({
        id: session.messages.length + 1, from: 'agent', text: ai.text,
        at: new Date().toISOString(), by: 'ai',
      });
      if (ai.lead) {
        session.lead = ai.lead;
        session.handedOff = true;
        if (ai.lead.name) session.name = ai.lead.name;
        if (ai.lead.contact) session.contact = ai.lead.contact;
        const to = session.manager || managers(env)[0] || env.AGENT_CHAT_ID;
        const card = await tg(env, 'sendMessage', {
          chat_id: to, parse_mode: 'HTML', text: leadCard(ai.lead, id, esc),
        });
        if (card.ok && card.result && card.result.message_id) {
          await env.CHAT.put(mapKey(card.result.message_id), id, { expirationTtl: SESSION_TTL });
        }
      }
      await saveSession(env, id, session);
      return json({ ok: true, id: msg.id, delivered: true, reply: ai.text, handedOff: !!ai.lead });
    }
    // Помощник недоступен — дальше по-старому, и больше его не дёргаем в этой сессии
    session.aiTurns = -1;
  }

  const header = first
    ? `🟢 <b>Новый диалог с сайта</b>\n<b>${esc(session.name)}</b>` +
      (session.contact ? ` · ${esc(session.contact)}` : '') +
      (page ? `\n<i>${esc(page)}</i>` : '')
    : `<b>${esc(session.name)}</b>`;

  const list = managers(env);
  const assigned = session.manager || list[0] || env.AGENT_CHAT_ID;
  const sent = await tg(env, 'sendMessage', {
    chat_id: assigned,
    parse_mode: 'HTML',
    text: `${header}\n\n${esc(text)}\n\n<code>#${id}</code>\n<i>Ответьте реплаем на это сообщение — ответ уйдёт на сайт.</i>`,
  });

  // Остальным дежурным — короткое уведомление, чтобы заявка не потерялась,
  // если назначенный не на связи. Отвечать по-прежнему можно реплаем у себя.
  if (first && list.length > 1) {
    for (const m of list) {
      if (String(m) === String(assigned)) continue;
      await tg(env, 'sendMessage', {
        chat_id: m, parse_mode: 'HTML',
        text: `🔔 Новая заявка с сайта от <b>${esc(session.name)}</b> — ` +
              `назначена дежурному.\n<code>#${id}</code>\n` +
              `<i>Если нужно перехватить, ответьте реплаем на это сообщение.</i>`,
      }).then(r => {
        if (r && r.ok && r.result) {
          return env.CHAT.put(mapKey(r.result.message_id), id, { expirationTtl: SESSION_TTL });
        }
      }).catch(() => {});
    }
  }

  // Связываем сообщение в Telegram с сессией: по нему найдём адресата ответа
  if (sent.ok && sent.result && sent.result.message_id) {
    await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
  }

  await saveSession(env, id, session);
  return json({ ok: true, id: msg.id, delivered: !!sent.ok });
}

/* ---------- посетитель наговаривает голосовое ----------
   Claude звук не слышит, поэтому запись не идёт в ИИ: она уходит дежурному
   в Telegram обычным голосовым, которое он слушает и отвечает реплаем.
   Сессия после этого ведётся человеком — иначе на голосовое отвечал бы
   дежурный, а на следующий текст снова ИИ, не зная, о чём была запись. */
async function handleVoice(request, env) {
  if (await rateLimited(env, request)) {
    return json({ error: 'too_many_requests', message: 'Слишком много сообщений. Подождите минуту.' }, 429);
  }

  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400); }

  const file = form.get('audio');
  if (!file || typeof file === 'string') return json({ error: 'no_audio' }, 400);
  if (file.size > MAX_VOICE) {
    return json({ error: 'too_big', message: 'Запись длинновата. Попробуйте короче — до минуты.' }, 413);
  }

  const id = clean(form.get('sessionId'), 40).replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return json({ error: 'empty' }, 400);

  const name = clean(form.get('name'), MAX_NAME) || 'Гость';
  const contact = clean(form.get('contact'), MAX_NAME);
  const page = clean(form.get('page'), 200);
  const secs = Math.min(parseInt(clean(form.get('seconds'), 6), 10) || 0, 600);

  let session = await loadSession(env, id);
  const first = !session;
  if (!session) {
    session = { created: new Date().toISOString(), name, contact, page, messages: [] };
    session.manager = await assignManager(env, id);
  }
  if (!session.manager) session.manager = await assignManager(env, id);
  if (name && name !== 'Гость') session.name = name;
  if (contact) session.contact = contact;
  session.handedOff = true;

  const msg = {
    id: session.messages.length + 1, from: 'user', kind: 'voice', seconds: secs,
    text: secs ? `🎤 Голосовое сообщение, ${secs} с` : '🎤 Голосовое сообщение',
    at: new Date().toISOString(),
  };
  session.messages.push(msg);

  /* Telegram показывает кружок-голосовое только для ogg/opus. Safari пишет
     в mp4, Chrome в webm — их отдаём как аудиофайл: он так же слушается
     в один тап, просто выглядит вложением. */
  const type = String(file.type || '');
  const ogg = type.includes('ogg');
  const method = ogg ? 'sendVoice' : 'sendAudio';
  const field = ogg ? 'voice' : 'audio';
  const ext = ogg ? 'ogg' : (type.includes('mp4') || type.includes('mpeg') ? 'm4a' : 'webm');

  const caption =
    (first
      ? `🟢 <b>Новый диалог с сайта</b>\n<b>${esc(session.name)}</b>` +
        (session.contact ? ` · ${esc(session.contact)}` : '') +
        (page ? `\n<i>${esc(page)}</i>` : '')
      : `<b>${esc(session.name)}</b>`) +
    `\n\n🎤 Голосовое с сайта\n\n<code>#${id}</code>\n` +
    `<i>Ответьте реплаем на это сообщение — ответ уйдёт на сайт.</i>`;

  const assigned = session.manager || managers(env)[0] || env.AGENT_CHAT_ID;
  const body = new FormData();
  body.append('chat_id', String(assigned));
  body.append('caption', caption);
  body.append('parse_mode', 'HTML');
  if (secs) body.append('duration', String(secs));
  body.append(field, file, `voice-${id}.${ext}`);

  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', body,
  });
  const sent = await r.json().catch(() => ({}));
  if (!sent.ok) console.error('telegram', method, JSON.stringify(sent).slice(0, 300));

  if (sent.ok && sent.result && sent.result.message_id) {
    await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
  }

  await saveSession(env, id, session);
  return json({ ok: !!sent.ok, id: msg.id, delivered: !!sent.ok });
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

  // Отвечать может любой из дежурных — chat_id сверяем со списком
  const list = managers(env);
  if (!list.some(m => String(m) === String(message.chat.id))) {
    return handleVisitorDM(message, env);
  }

  if (message.text.startsWith('/chatid')) {
    await tg(env, 'sendMessage', { chat_id: message.chat.id, text: `chat_id: ${message.chat.id}` });
    return new Response('ok');
  }
  if (message.text.startsWith('/duty')) {
    const n = parseInt((await env.CHAT.get('rr:counter')) || '0', 10);
    const next = list.length ? list[n % list.length] : '—';
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id, parse_mode: 'HTML',
      text: `Дежурных в ротации: <b>${list.length}</b>\n` +
            `Следующая заявка уйдёт: <code>${esc(String(next))}</code>\n` +
            (String(next) === String(message.chat.id) ? 'Это вы.' : ''),
    });
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

  const answer = clean(message.text, MAX_TEXT);
  session.messages.push({
    id: session.messages.length + 1,
    from: 'agent',
    text: answer,
    at: new Date().toISOString(),
  });

  // Диалог из бота: виджета на сайте нет, опрашивать некому — досылаем сами
  if (sessionId.startsWith('tg')) {
    const to = sessionId.slice(2);
    const ok = await tg(env, 'sendMessage', { chat_id: to, text: answer });
    if (!ok.ok) {
      await tg(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'Не смог доставить ответ клиенту в Telegram — возможно, он заблокировал бота.',
      });
    }
  }

  // Кто фактически ответил — тот и ведёт диалог дальше
  session.manager = String(message.chat.id);
  // И с этого момента говорит он, а не помощник: два голоса в одном чате
  // клиент читает как неразбериху, а не как заботу
  session.handedOff = true;
  await saveSession(env, sessionId, session);
  await tg(env, 'setMessageReaction', {
    chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '👌' }],
  });
  return new Response('ok');
}

/* ---------- посетитель пишет боту напрямую ----------
   Тот же первичный менеджер, что и в чате на сайте, и та же карточка дежурному.
   Разговор, начатый в Telegram, и разговор с сайта не должны вести себя
   по-разному — иначе у клиента два разных агентства. */
async function handleVisitorDM(message, env) {
  const chatId = String(message.chat.id);
  const id = 'tg' + chatId;
  const text = clean(message.text, MAX_TEXT);

  const site = (env.SITE_URL || 'https://estateart.homes/').replace(/\/+$/, '') + '/';

  /* /chatid доступна всем, а не только дежурным: без неё новый менеджер не
     может узнать свой id, чтобы его вписали в AGENT_CHAT_ID, — а узнать его
     больше негде, потому что getUpdates молчит, пока стоит вебхук. Id чата
     не секрет: он бесполезен без токена бота. */
  if (text.startsWith('/chatid')) {
    const kind = message.chat.type === 'private' ? 'личный чат' : 'группа';
    await tg(env, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `<b>chat_id:</b> <code>${esc(chatId)}</code>\n${kind}\n\n` +
            `<i>Это значение нужно вписать в AGENT_CHAT_ID, чтобы сюда падали заявки.</i>`,
    });
    return new Response('ok');
  }
  if (text.startsWith('/catalog')) {
    await tg(env, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: 'Каталог: виллы и квартиры на Пхукете, в Дананге и Нячанге.',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть каталог', url: site + '#catalog' }]] },
    });
    return new Response('ok');
  }
  if (text.startsWith('/contact')) {
    await tg(env, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: 'Напишите здесь, что ищете, — передам агенту. Или свяжитесь напрямую:',
      reply_markup: { inline_keyboard: [[
        { text: 'WhatsApp', url: 'https://wa.me/79124869508' },
        { text: 'Сайт', url: site },
      ]] },
    });
    return new Response('ok');
  }
  if (text.startsWith('/duty')) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Эта команда — для дежурных менеджеров.' });
    return new Response('ok');
  }

  let session = await loadSession(env, id);
  if (!session) {
    const who = [message.from && message.from.first_name, message.from && message.from.last_name]
      .filter(Boolean).join(' ');
    session = {
      created: new Date().toISOString(),
      name: clean(who, MAX_NAME) || 'Гость',
      contact: message.from && message.from.username ? '@' + message.from.username : '',
      page: 'Telegram',
      source: 'telegram',
      messages: [],
    };
    session.manager = await assignManager(env, id);
  }

  if (text.startsWith('/start')) {
    session.messages = [];
    delete session.handedOff;
    delete session.aiTurns;
    await saveSession(env, id, session);
    await tg(env, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      disable_web_page_preview: true,
      text:
        `<b>ESTATE ART</b>\n` +
        `<i>Недвижимость на Пхукете и во Вьетнаме</i>\n\n` +
        `Виллы и квартиры в Таиланде и Вьетнаме: Пхукет, Дананг, Нячанг. ` +
        `Подбираем объект под задачу — жить, сдавать или держать, — проверяем ` +
        `документы и ведём сделку от первого показа до ключей.\n\n` +
        `Работаем удалённо: онлайн-показы, видео-туры, сопровождение переводов.\n\n` +
        `<b>Расскажите, что ищете</b> — город, тип жилья, примерный бюджет. ` +
        `Отвечу по рынку и передам агенту.`,
      reply_markup: { inline_keyboard: [
        [{ text: 'Смотреть каталог', url: site + '#catalog' }],
        [{ text: 'Районы', url: site + '#districts' }, { text: 'Вопросы и ответы', url: site + '#faq' }],
      ] },
    });
    return new Response('ok');
  }

  session.messages.push({
    id: session.messages.length + 1, from: 'user', text, at: new Date().toISOString(),
  });

  // Дежурный уже подхватил — пересылаем ему, помощник молчит
  if (session.handedOff) {
    const to = session.manager || managers(env)[0] || env.AGENT_CHAT_ID;
    const sent = await tg(env, 'sendMessage', {
      chat_id: to, parse_mode: 'HTML',
      text: `<b>${esc(session.name)}</b> (Telegram)\n\n${esc(text)}\n\n<code>#${id}</code>\n` +
            `<i>Ответьте реплаем — ответ уйдёт клиенту в Telegram.</i>`,
    });
    if (sent.ok && sent.result && sent.result.message_id) {
      await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
    }
    await saveSession(env, id, session);
    return new Response('ok');
  }

  await tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  const ranges = await priceRanges(env);
  const ai = (session.aiTurns === -1 || (session.aiTurns || 0) >= AI_TURNS)
    ? null : await aiReply(env, session, null, ranges);

  if (!ai || !ai.text) {
    // Помощник недоступен — не теряем человека, отдаём дежурному сразу
    session.aiTurns = -1;
    session.handedOff = true;
    const to = session.manager || managers(env)[0] || env.AGENT_CHAT_ID;
    const sent = await tg(env, 'sendMessage', {
      chat_id: to, parse_mode: 'HTML',
      text: `🟢 <b>Обращение в бот</b>\n<b>${esc(session.name)}</b>` +
            (session.contact ? ` · ${esc(session.contact)}` : '') +
            `\n\n${esc(text)}\n\n<code>#${id}</code>\n` +
            `<i>Ответьте реплаем — ответ уйдёт клиенту в Telegram.</i>`,
    });
    if (sent.ok && sent.result && sent.result.message_id) {
      await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
    }
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Передаю вас агенту — он ответит здесь.' });
    await saveSession(env, id, session);
    return new Response('ok');
  }

  session.aiTurns = (session.aiTurns || 0) + 1;
  session.messages.push({
    id: session.messages.length + 1, from: 'agent', text: ai.text,
    at: new Date().toISOString(), by: 'ai',
  });
  await tg(env, 'sendMessage', { chat_id: chatId, text: ai.text });

  if (ai.lead) {
    session.lead = ai.lead;
    session.handedOff = true;
    if (ai.lead.name) session.name = ai.lead.name;
    if (ai.lead.contact) session.contact = ai.lead.contact;
    const to = session.manager || managers(env)[0] || env.AGENT_CHAT_ID;
    const card = await tg(env, 'sendMessage', {
      chat_id: to, parse_mode: 'HTML',
      text: leadCard(ai.lead, id, esc).replace('Заявка с сайта', 'Заявка из бота'),
    });
    if (card.ok && card.result && card.result.message_id) {
      await env.CHAT.put(mapKey(card.result.message_id), id, { expirationTtl: SESSION_TTL });
    }
  }

  await saveSession(env, id, session);
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
      if (url.pathname === '/api/voice' && request.method === 'POST') {
        const res = await handleVoice(request, env);
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
