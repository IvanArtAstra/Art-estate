/**
 * Estate Art — мост между сайтом, личным кабинетом, ИИ-консультантом и Telegram.
 *
 * - Чат на сайте + ИИ-консультант с доступом к каталогу и объектам из кабинета
 * - Эскалация живому менеджеру в Telegram (автоматически и по кнопке)
 * - Личный кабинет: регистрация/вход, добавление объектов и фото, модерация в Telegram
 * - Регионализация (/api/geo), быстрый онбординг (/api/onboarding), заявки с форм (/api/lead)
 * - Почта домена и партнёрская воронка (bot/mail.js, bot/partners.js)
 */
import { aiReply, leadCard } from './ai.js';
import { handleEmail, mailChats, handleMailCallback } from './mail.js';
import { handleOutboxCallback, handleOutboxReply, runSchedule, partnersReport, queueKeyboard } from './partners.js';
import {
  extractContacts,
  resolveIdentity,
  recordInquiry,
  linkTelegramChatToUser,
  formatIdentityForAdmin,
} from './identity.js';
import {
  requireAuth,
  handleGeo,
  handlePublicListings,
  handleMedia,
  handleRegister,
  handleLogin,
  handleLogout,
  handleMe,
  handleUpdateProfile,
  handleMyListings,
  handleCreateListing,
  handleUpdateListing,
  handleDeleteListing,
  handlePhotoUpload,
  handleOnboarding,
  handleSiteLead,
  handleCabinetCallback,
  getApprovedListings,
  cabinetStatsReport,
  sendPendingListings,
} from './cabinet.js';

export { AnthropicRelay } from './relay.js';

const MAX_TEXT = 2000;
const MAX_NAME = 80;
const SESSION_TTL = 60 * 60 * 24 * 14;
const RATE_LIMIT = 20;
const MAX_MESSAGES = 200;
const AI_TURNS = 12;
const RANGES_TTL = 60 * 60 * 6;
const CATALOG_TTL = 60 * 60;
const MAX_VOICE = 1500000;

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
    return null;
  }
}

async function staticListings(env) {
  try {
    const cached = await env.CHAT.get('catalog_merged:v1');
    if (cached) return JSON.parse(cached);
    const base = (env.SITE_URL || 'https://estateart.homes/').replace(/\/+$/, '');
    const [catRes, rentRes] = await Promise.all([
      fetch(base + '/data/catalog.json', { cf: { cacheTtl: 1800 } }).catch(() => null),
      fetch(base + '/data/rentals.json', { cf: { cacheTtl: 1800 } }).catch(() => null),
    ]);
    const items = [];
    if (catRes && catRes.ok) {
      const d = await catRes.json().catch(() => null);
      if (d && Array.isArray(d.items)) {
        for (const it of d.items) {
          if (!it.hidden) items.push(it);
        }
      }
    }
    if (rentRes && rentRes.ok) {
      const d = await rentRes.json().catch(() => null);
      if (d && Array.isArray(d.items)) {
        for (const it of d.items) items.push(Object.assign({ deal: 'rent' }, it));
      }
    }
    if (items.length) {
      await env.CHAT.put('catalog_merged:v1', JSON.stringify(items), { expirationTtl: CATALOG_TTL });
    }
    return items;
  } catch (e) {
    console.log('staticListings err:', e && e.message);
    return [];
  }
}

async function loadAllListings(env, origin = '') {
  const [ownerItems, siteItems] = await Promise.all([
    getApprovedListings(env, origin).catch(() => []),
    staticListings(env),
  ]);
  const seen = new Set(ownerItems.map(x => String(x.id)));
  return ownerItems.concat(siteItems.filter(x => !seen.has(String(x.id))));
}

function chatList(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function staffDeps() {
  return { tg, esc, managers, chats: e => mailChats(e, { managers }) };
}

function managers(env) {
  const channels = new Set(chatList(env.CHANNEL_CHAT_ID));
  return chatList(env.AGENT_CHAT_ID).filter(id => !channels.has(id));
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
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(res, cors) {
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
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

function applySessionContext(session, body) {
  if (!body || typeof body !== 'object') return;
  if (body.geo && typeof body.geo === 'object') {
    session.geo = {
      country: clean(body.geo.country, 8).toLowerCase(),
      countryName: clean(body.geo.countryName, 60),
      city: clean(body.geo.city, 60),
    };
  }
  if (body.onboarding && typeof body.onboarding === 'object') {
    session.onboarding = {
      goal: clean(body.onboarding.goal, 40),
      country: clean(body.onboarding.country, 20),
      city: clean(body.onboarding.city, 60),
      type: clean(body.onboarding.type, 40),
      budget: clean(body.onboarding.budget, 40),
    };
  }
  if (body.profile && typeof body.profile === 'object') {
    session.profile = {
      name: clean(body.profile.name, MAX_NAME),
      contact: clean(body.profile.contact, MAX_NAME),
      email: clean(body.profile.email, 120),
      phone: clean(body.profile.phone, 40),
      telegram: clean(body.profile.telegram, 60),
      company: clean(body.profile.company, 120),
      role: clean(body.profile.role, 30),
    };
    if (session.profile.name && (!session.name || session.name === 'Гость')) session.name = session.profile.name;
    if (session.profile.contact && !session.contact) session.contact = session.profile.contact;
  }
  if (body.contextListing && typeof body.contextListing === 'object') {
    session.contextListing = {
      id: clean(body.contextListing.id, 40),
      title: clean(body.contextListing.title, 120),
      city: clean(body.contextListing.city, 60),
      price: clean(body.contextListing.price, 40),
      deal: clean(body.contextListing.deal, 16),
      ownerListing: !!body.contextListing.ownerListing,
    };
  }
  if (body.lang) session.lang = clean(body.lang, 10);
}

async function notifyOtherAdminsForSession(env, assigned, id, cardText) {
  const deps = staffDeps();
  const allAdmins = [...new Set(deps.chats(env).concat(managers(env)).map(String).filter(Boolean))];
  for (const m of allAdmins) {
    if (String(m) === String(assigned)) continue;
    await tg(env, 'sendMessage', {
      chat_id: m,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: cardText,
    }).then(r => {
      if (r && r.ok && r.result) {
        return env.CHAT.put(mapKey(r.result.message_id), id, { expirationTtl: SESSION_TTL });
      }
    }).catch(() => {});
  }
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
  if (page) session.page = page;
  applySessionContext(session, body);

  const msg = { id: session.messages.length + 1, from: 'user', text, at: new Date().toISOString() };
  session.messages.push(msg);

  const verifiedUser = await requireAuth(request, env);
  if (verifiedUser) {
    session.verifiedAccount = true;
    session.linkedUserId = verifiedUser.id;
  }
  const ex = extractContacts(text, {
    contact: session.contact,
    email: verifiedUser && verifiedUser.email,
    phone: verifiedUser && verifiedUser.phone,
    telegram: verifiedUser && verifiedUser.telegram,
    company: (verifiedUser && verifiedUser.company) || (session.profile && session.profile.company),
  });
  if (!session.contact) {
    session.contact = ex.emails[0] || (ex.phones[0] ? '+' + ex.phones[0] : '') || ex.telegrams[0] || '';
  }

  const identity = await resolveIdentity(env, {
    userId: (verifiedUser && verifiedUser.id) || session.linkedUserId,
    text,
    contact: session.contact,
    email: verifiedUser && verifiedUser.email,
    phone: verifiedUser && verifiedUser.phone,
    telegram: verifiedUser && verifiedUser.telegram,
    company: (verifiedUser && verifiedUser.company) || ex.company,
    name: session.name,
  }, { verified: !!verifiedUser });

  if (identity.user && !session.linkedUserId) session.linkedUserId = identity.user.id;
  if (ex.emails.length || ex.phones.length || ex.telegrams.length || session.linkedUserId) {
    await recordInquiry(env, {
      userId: session.linkedUserId,
      name: session.name,
      role: (identity.user && identity.user.role) || (session.profile && session.profile.role),
      contacts: ex,
      channel: 'site_chat',
      summary: text.slice(0, 220),
      listingId: session.contextListing && session.contextListing.id,
      listingTitle: session.contextListing && session.contextListing.title,
      region: session.geo && [session.geo.city, session.geo.countryName].filter(Boolean).join(', '),
    });
  }

  if (!session.handedOff && session.aiTurns !== -1 && (session.aiTurns || 0) < AI_TURNS) {
    const origin = new URL(request.url).origin;
    const [ranges, listings] = await Promise.all([
      priceRanges(env),
      loadAllListings(env, origin),
    ]);
    const ai = await aiReply(env, session, null, ranges, listings, identity);
    if (ai && ai.text) {
      session.aiTurns = (session.aiTurns || 0) + 1;
      const replyMsg = {
        id: session.messages.length + 1, from: 'agent', text: ai.text,
        at: new Date().toISOString(), by: 'ai',
      };
      session.messages.push(replyMsg);
      if (ai.lead) {
        session.lead = ai.lead;
        session.handedOff = true;
        if (ai.lead.name) session.name = ai.lead.name;
        if (ai.lead.contact) session.contact = ai.lead.contact;
        const to = session.manager || managers(env)[0];
        const cardHtml = leadCard(ai.lead, id, esc, session, identity);
        const card = await tg(env, 'sendMessage', {
          chat_id: to, parse_mode: 'HTML', text: cardHtml,
        });
        if (card.ok && card.result && card.result.message_id) {
          await env.CHAT.put(mapKey(card.result.message_id), id, { expirationTtl: SESSION_TTL });
        }
        await notifyOtherAdminsForSession(
          env, to, id,
          `🔔 <b>Лид от ИИ-консультанта (копия руководству)</b>\n` +
          `<b>${esc(session.name)}</b>${session.contact ? ' · ' + esc(session.contact) : ''}` +
          (ai.lead.looking_for ? `\nЗапрос: ${esc(ai.lead.looking_for)}` : '') +
          `\n<code>#${id}</code>`
        );
      }
      await saveSession(env, id, session);
      return json({ ok: true, id: msg.id, delivered: true, reply: ai.text, handedOff: !!ai.lead });
    }
    session.aiTurns = -1;
  }

  const dossier = formatIdentityForAdmin(identity, esc);
  const geoTag = session.geo && (session.geo.city || session.geo.countryName)
    ? `\n📍 ${esc([session.geo.city, session.geo.countryName].filter(Boolean).join(', '))}` : '';
  const objTag = session.contextListing && session.contextListing.title
    ? `\n🏠 Объект: ${esc(session.contextListing.title)}` : '';

  const header = first
    ? `🟢 <b>Новый диалог с сайта</b>\n<b>${esc(session.name)}</b>` +
      (session.contact ? ` · ${esc(session.contact)}` : '') +
      (page ? `\n<i>${esc(page)}</i>` : '') + geoTag + objTag +
      (dossier ? `\n\n${dossier}` : '')
    : `<b>${esc(session.name)}</b>`;

  const list = managers(env);
  const assigned = session.manager || list[0];
  const sent = await tg(env, 'sendMessage', {
    chat_id: assigned,
    parse_mode: 'HTML',
    text: `${header}\n\n${esc(text)}\n\n<code>#${id}</code>\n<i>Ответьте реплаем на это сообщение — ответ уйдёт на сайт.</i>`,
  });

  if (first) {
    await notifyOtherAdminsForSession(
      env, assigned, id,
      `🔔 Новая заявка с сайта от <b>${esc(session.name)}</b>` +
      (session.contact ? ` (${esc(session.contact)})` : '') +
      geoTag + objTag +
      `\n<code>#${id}</code>\n<i>Чтобы перехватить диалог, ответьте реплаем на это сообщение.</i>`
    );
  }

  if (sent.ok && sent.result && sent.result.message_id) {
    await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
  }

  await saveSession(env, id, session);
  return json({ ok: true, id: msg.id, delivered: !!sent.ok });
}

/* ---------- явный вызов менеджера из чата на сайте ---------- */
async function handleHandoff(request, env) {
  if (await rateLimited(env, request)) {
    return json({ error: 'too_many_requests', message: 'Подождите минуту.' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const id = clean(body.sessionId, 40).replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return json({ error: 'empty' }, 400);

  const name = clean(body.name, MAX_NAME) || 'Гость';
  const contact = clean(body.contact, MAX_NAME);
  const note = clean(body.note, 500);
  const page = clean(body.page, 200);

  let session = await loadSession(env, id);
  if (!session) {
    session = { created: new Date().toISOString(), name, contact, page, messages: [] };
    session.manager = await assignManager(env, id);
  }
  if (!session.manager) session.manager = await assignManager(env, id);
  if (name && name !== 'Гость') session.name = name;
  if (contact) session.contact = contact;
  if (page) session.page = page;
  applySessionContext(session, body);
  session.handedOff = true;

  const verifiedUser = await requireAuth(request, env);
  const identity = await resolveIdentity(env, {
    userId: (verifiedUser && verifiedUser.id) || session.linkedUserId,
    contact: session.contact,
    email: verifiedUser && verifiedUser.email,
    phone: verifiedUser && verifiedUser.phone,
    telegram: verifiedUser && verifiedUser.telegram,
    company: (verifiedUser && verifiedUser.company) || (session.profile && session.profile.company),
    name: session.name,
  }, { verified: true });
  const dossier = formatIdentityForAdmin(identity, esc);

  const historySnippet = (session.messages || [])
    .filter(m => m.from === 'user' && m.text)
    .slice(-4)
    .map(m => `• ${esc(m.text.slice(0, 180))}`)
    .join('\n');

  const geoTxt = session.geo && (session.geo.city || session.geo.countryName)
    ? `\n<b>Регион входа:</b> ${esc([session.geo.city, session.geo.countryName].filter(Boolean).join(', '))}` : '';
  const objTxt = session.contextListing && session.contextListing.title
    ? `\n<b>Объект:</b> ${esc(session.contextListing.title)}` : '';
  const obTxt = session.onboarding
    ? `\n<b>Онбординг:</b> ${esc([session.onboarding.goal, session.onboarding.country, session.onboarding.type, session.onboarding.budget].filter(Boolean).join(' · '))}` : '';

  const text =
    `🙋 <b>Клиент позвал менеджера из чата</b>\n` +
    `<b>Имя:</b> ${esc(session.name)}\n` +
    `<b>Контакт:</b> ${esc(session.contact || 'не указан (ждёт ответа на сайте)')}` +
    geoTxt + objTxt + obTxt +
    (note ? `\n<b>Комментарий:</b> ${esc(note)}` : '') +
    (dossier ? `\n\n${dossier}` : '') +
    (historySnippet ? `\n\n<b>Последние сообщения:</b>\n${historySnippet}` : '') +
    `\n\n<code>#${id}</code>\n<i>Ответьте реплаем — ответ сразу появится у клиента в чате.</i>`;

  const assigned = session.manager || managers(env)[0];
  const sent = await tg(env, 'sendMessage', {
    chat_id: assigned,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text,
  });
  if (sent.ok && sent.result && sent.result.message_id) {
    await env.CHAT.put(mapKey(sent.result.message_id), id, { expirationTtl: SESSION_TTL });
  }
  await notifyOtherAdminsForSession(env, assigned, id, text);

  const notice = {
    id: session.messages.length + 1,
    from: 'agent',
    text: 'Передал диалог живому менеджеру в Telegram — он уже видит вашу переписку и скоро ответит здесь.',
    at: new Date().toISOString(),
    by: 'system',
  };
  session.messages.push(notice);
  await saveSession(env, id, session);

  return json({ ok: true, id: notice.id, reply: notice.text, handedOff: true });
}

/* ---------- посетитель наговаривает голосовое ---------- */
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

  const assigned = session.manager || managers(env)[0];
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

  if (update.callback_query) {
    const data = String(update.callback_query.data || '');
    if (data.startsWith('ml:')) {
      await handleMailCallback(update.callback_query, env, { tg, esc, managers });
    } else if (data.startsWith('ob:')) {
      await handleOutboxCallback(update.callback_query, env, staffDeps());
    } else if (data.startsWith('cab:')) {
      await handleCabinetCallback(update.callback_query, env, staffDeps());
    }
    return new Response('ok');
  }

  const message = update.message || update.edited_message;
  if (!message || (!message.text && !message.contact)) return new Response('ok');

  const list = managers(env);
  const adminSet = new Set(staffDeps().chats(env).concat(list).map(String));
  if (!adminSet.has(String(message.chat.id))) {
    return handleVisitorDM(message, env);
  }
  if (!message.text) return new Response('ok');

  if (message.text.startsWith('/chatid')) {
    await tg(env, 'sendMessage', { chat_id: message.chat.id, text: `chat_id: ${message.chat.id}` });
    return new Response('ok');
  }
  if (message.text.startsWith('/client')) {
    const query = clean(message.text.replace(/^\/client(?:@\S+)?\s*/i, ''), 120);
    if (!query) {
      await tg(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'Укажите email, телефон, @telegram или компанию. Например:\n/client +79124869508\n/client partner@agency.com',
      });
      return new Response('ok');
    }
    const idn = await resolveIdentity(env, { text: query, company: query }, { verified: true });
    const dossier = formatIdentityForAdmin(idn, esc);
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: dossier || `По запросу <code>${esc(query)}</code> аккаунтов, объектов и обращений не найдено.`,
    });
    return new Response('ok');
  }
  if (message.text.startsWith('/cabinet') || message.text.startsWith('/stats')) {
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id,
      parse_mode: 'HTML',
      text: await cabinetStatsReport(env, staffDeps()),
    });
    return new Response('ok');
  }
  if (message.text.startsWith('/pending')) {
    await sendPendingListings(message.chat.id, env, staffDeps());
    return new Response('ok');
  }
  if (message.text.startsWith('/partners')) {
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id, parse_mode: 'HTML', text: await partnersReport(env, staffDeps()),
    });
    return new Response('ok');
  }
  if (message.text.startsWith('/queue')) {
    await tg(env, 'sendMessage', {
      chat_id: message.chat.id, parse_mode: 'HTML', text: await partnersReport(env, staffDeps()),
      reply_markup: await queueKeyboard(env),
    });
    return new Response('ok');
  }
  if (await handleOutboxReply(message, env, staffDeps())) return new Response('ok');

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
      text: 'Чтобы ответить посетителю, сделайте реплай на его сообщение. Команды: /cabinet, /pending, /client, /duty, /partners.',
    });
    return new Response('ok');
  }

  let sessionId = await env.CHAT.get(mapKey(replyTo.message_id));
  if (!sessionId) {
    const m = (replyTo.text || replyTo.caption || '').match(/#([A-Za-z0-9_-]{6,40})/);
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

  session.manager = String(message.chat.id);
  session.handedOff = true;
  await saveSession(env, sessionId, session);
  await tg(env, 'setMessageReaction', {
    chat_id: message.chat.id, message_id: message.message_id, reaction: [{ type: 'emoji', emoji: '👌' }],
  });
  return new Response('ok');
}

/* ---------- посетитель пишет боту напрямую ---------- */
async function handleVisitorDM(message, env) {
  const chatId = String(message.chat.id);
  const id = 'tg' + chatId;
  const site = (env.SITE_URL || 'https://estateart.homes/').replace(/\/+$/, '') + '/';

  // Пользователь поделился контактом (номером телефона) в Telegram
  if (message.contact && message.contact.phone_number) {
    const phoneRaw = '+' + String(message.contact.phone_number).replace(/^\+/, '');
    const tgHandle = message.from && message.from.username ? '@' + message.from.username : '';
    const identity = await resolveIdentity(env, {
      telegramChatId: chatId,
      phone: phoneRaw,
      telegram: tgHandle,
      name: [message.contact.first_name, message.contact.last_name].filter(Boolean).join(' '),
    }, { verified: true });

    if (identity.user) {
      await linkTelegramChatToUser(env, chatId, identity.user.id);
    }
    await recordInquiry(env, {
      userId: identity.user && identity.user.id,
      name: (identity.user && identity.user.name) || message.contact.first_name || 'Гость',
      phone: phoneRaw,
      telegram: tgHandle,
      telegramChatId: chatId,
      channel: 'telegram_contact',
      summary: 'Поделился номером телефона в Telegram',
    });

    let replyText = `Спасибо, контакт <b>${esc(phoneRaw)}</b> сохранён.`;
    if (identity.user) {
      replyText = `Узнал ваш аккаунт: <b>${esc(identity.user.name)}</b>` +
        (identity.user.company ? ` (${esc(identity.user.company)})` : '') + `.`;
      if (identity.userListings && identity.userListings.length) {
        replyText += `\n\nВаши объекты в кабинете (${identity.userListings.length}):\n` +
          identity.userListings.slice(0, 5).map(p => `• ${esc(p.title)} (${esc(p.status)})`).join('\n');
      }
      replyText += `\n\nМожете спрашивать о своих объектах, статусах или новых запросах — отвечу здесь.`;
    } else {
      replyText += ` Можете написать, что ищете или какой объект хотите разместить — я помогу.`;
    }
    await tg(env, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: replyText });
    return new Response('ok');
  }

  const text = clean(message.text, MAX_TEXT);
  if (!text) return new Response('ok');

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
      text: 'Каталог: виллы и квартиры на Пхукете, в Дананге, Нячанге и в вашем регионе.',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть каталог', url: site + '#catalog' }, { text: 'Личный кабинет', url: site + 'cabinet/' }]] },
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

  const tgHandle = message.from && message.from.username ? '@' + message.from.username : '';
  const ex = extractContacts(text, { telegram: tgHandle, telegramChatId: chatId, contact: session.contact });
  const identity = await resolveIdentity(env, {
    userId: session.linkedUserId,
    telegramChatId: chatId,
    telegram: tgHandle,
    text,
    contact: session.contact,
    name: session.name,
  }, { verified: true });

  if (identity.user) {
    session.linkedUserId = identity.user.id;
    session.verifiedAccount = true;
    await linkTelegramChatToUser(env, chatId, identity.user.id);
    if (!session.name || session.name === 'Гость') session.name = identity.user.name;
  }

  if (text.startsWith('/my')) {
    const dossier = formatIdentityForAdmin(identity, esc);
    if (!identity.matched) {
      await tg(env, 'sendMessage', {
        chat_id: chatId, parse_mode: 'HTML',
        text: 'Пока не вижу вашего профиля. Напишите сюда ваш <b>email</b> или <b>номер телефона</b> (или поделитесь контактом), либо войдите в личный кабинет.',
        reply_markup: { inline_keyboard: [[{ text: 'Открыть личный кабинет', url: site + 'cabinet/' }]] },
      });
    } else {
      await tg(env, 'sendMessage', {
        chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `<b>Ваш профиль в Estate Art</b>\n\n${dossier}`,
        reply_markup: { inline_keyboard: [[{ text: 'Управление в кабинете', url: site + 'cabinet/#my-objects' }]] },
      });
    }
    return new Response('ok');
  }

  if (text.startsWith('/start')) {
    session.messages = [];
    delete session.handedOff;
    delete session.aiTurns;
    await saveSession(env, id, session);
    const greetOwn = identity.user
      ? `\n\nУзнал ваш аккаунт: <b>${esc(identity.user.name)}</b>` +
        (identity.userListings.length ? ` · объектов в кабинете: <b>${identity.userListings.length}</b>` : '') +
        `. Команда /my покажет ваши объекты и запросы.`
      : '';
    await tg(env, 'sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      disable_web_page_preview: true,
      text:
        `<b>ESTATE ART</b>\n` +
        `<i>Недвижимость у моря и в вашем регионе</i>\n\n` +
        `Виллы и квартиры в Таиланде, Вьетнаме и других странах. ` +
        `Подбираем объект под задачу — жить, сдавать или держать, — и помогаем ` +
        `разместить собственные объекты через личный кабинет.\n\n` +
        `<b>Расскажите, что ищете</b> — город, тип жилья, бюджет — или напишите свой email/телефон, чтобы я подтянул ваши объекты и запросы.` +
        greetOwn,
      reply_markup: { inline_keyboard: [
        [{ text: 'Смотреть каталог', url: site + '#catalog' }, { text: 'Личный кабинет', url: site + 'cabinet/' }],
        [{ text: 'Районы', url: site + '#districts' }, { text: 'Добавить объект', url: site + 'cabinet/#add' }],
      ] },
    });
    return new Response('ok');
  }

  session.messages.push({
    id: session.messages.length + 1, from: 'user', text, at: new Date().toISOString(),
  });

  if (ex.emails.length || ex.phones.length || ex.telegrams.length || session.linkedUserId) {
    await recordInquiry(env, {
      userId: session.linkedUserId,
      name: session.name,
      role: identity.user && identity.user.role,
      contacts: ex,
      channel: 'telegram_dm',
      summary: text.slice(0, 220),
    });
  }

  if (session.handedOff) {
    const to = session.manager || managers(env)[0];
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
  const [ranges, listings] = await Promise.all([
    priceRanges(env),
    loadAllListings(env, site.replace(/\/+$/, '')),
  ]);
  const ai = (session.aiTurns === -1 || (session.aiTurns || 0) >= AI_TURNS)
    ? null : await aiReply(env, session, null, ranges, listings, identity);

  if (!ai || !ai.text) {
    session.aiTurns = -1;
    session.handedOff = true;
    const dossier = formatIdentityForAdmin(identity, esc);
    const to = session.manager || managers(env)[0];
    const sent = await tg(env, 'sendMessage', {
      chat_id: to, parse_mode: 'HTML',
      text: `🟢 <b>Обращение в бот</b>\n<b>${esc(session.name)}</b>` +
            (session.contact ? ` · ${esc(session.contact)}` : '') +
            `\n\n${esc(text)}` +
            (dossier ? `\n\n${dossier}` : '') +
            `\n\n<code>#${id}</code>\n` +
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
    const to = session.manager || managers(env)[0];
    const card = await tg(env, 'sendMessage', {
      chat_id: to, parse_mode: 'HTML',
      text: leadCard(ai.lead, id, esc, session, identity).replace('Заявка с сайта', 'Заявка из бота'),
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
      if (url.pathname === '/api/telegram' && request.method === 'POST') {
        return await handleTelegram(request, env);
      }

      const deps = staffDeps();
      let res = null;

      if (url.pathname === '/api/health') {
        const all = chatList(env.AGENT_CHAT_ID);
        const staff = managers(env);
        res = json({ ok: true, managers: staff.length, channelInAgents: all.length - staff.length });
      } else if (url.pathname === '/api/geo' && request.method === 'GET') {
        res = await handleGeo(request, env);
      } else if (url.pathname === '/api/listings' && request.method === 'GET') {
        res = await handlePublicListings(request, env);
      } else if (url.pathname.startsWith('/api/media/') && request.method === 'GET') {
        const photoId = url.pathname.slice('/api/media/'.length).replace(/\/+$/, '');
        res = await handleMedia(request, env, photoId);
      } else if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        res = await handleRegister(request, env, deps);
      } else if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        res = await handleLogin(request, env);
      } else if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        res = await handleLogout(request, env);
      } else if (url.pathname === '/api/cabinet/me' && request.method === 'GET') {
        res = await handleMe(request, env);
      } else if (url.pathname === '/api/cabinet/profile' && (request.method === 'PUT' || request.method === 'POST')) {
        res = await handleUpdateProfile(request, env);
      } else if (url.pathname === '/api/cabinet/listings' && request.method === 'GET') {
        res = await handleMyListings(request, env);
      } else if (url.pathname === '/api/cabinet/listings' && request.method === 'POST') {
        res = await handleCreateListing(request, env, deps);
      } else if (url.pathname.startsWith('/api/cabinet/listings/')) {
        const propId = url.pathname.slice('/api/cabinet/listings/'.length).replace(/\/+$/, '');
        if (request.method === 'PUT' || request.method === 'PATCH') {
          res = await handleUpdateListing(request, env, deps, propId);
        } else if (request.method === 'DELETE') {
          res = await handleDeleteListing(request, env, propId);
        }
      } else if (url.pathname === '/api/cabinet/photos' && request.method === 'POST') {
        res = await handlePhotoUpload(request, env);
      } else if (url.pathname === '/api/onboarding' && request.method === 'POST') {
        res = await handleOnboarding(request, env, deps);
      } else if (url.pathname === '/api/lead' && request.method === 'POST') {
        res = await handleSiteLead(request, env, deps);
      } else if (url.pathname === '/api/handoff' && request.method === 'POST') {
        res = await handleHandoff(request, env);
      } else if (url.pathname === '/api/send' && request.method === 'POST') {
        res = await handleSend(request, env);
      } else if (url.pathname === '/api/voice' && request.method === 'POST') {
        res = await handleVoice(request, env);
      } else if (url.pathname === '/api/poll' && request.method === 'GET') {
        res = await handlePoll(request, env);
      }

      if (res) return withCors(res, cors);
      return withCors(new Response('not found', { status: 404 }), cors);
    } catch (err) {
      console.error('worker', err && err.stack || err);
      return withCors(json({ error: 'internal' }, 500), cors);
    }
  },

  async email(message, env) {
    await handleEmail(message, env, { tg, esc, managers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, staffDeps()));
  },
};
