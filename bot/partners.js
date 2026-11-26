/* ============================================================
   Estate Art — переписка с партнёрами: воронка, очередь писем,
   напоминания.

   Воронка. Каждый брокер или застройщик, с которым идёт переписка,
   живёт в KV под ключом pt:<email>. Этапы:
     queued   — первое письмо стоит в очереди
     sent     — написали, ждём ответа
     replied  — ответили
     terms    — назвали условия (комиссия, выплата)
     objects  — прислали объекты: ссылку, архив, таблицу
     listed   — объекты на сайте
     declined — отказались или попросили не писать
   Входящее письмо двигает партнёра по воронке, а о двух главных событиях
   (условия и объекты) бот пишет отдельным уведомлением обоим админам.

   Очередь. Любое исходящее письмо — запись ob:<id>. Первые письма сначала
   ждут одобрения (obp:), после одобрения встают в очередь отправки (obq:),
   а cron раз в полчаса отправляет их по одному, в рабочие часы Вьетнама и не
   больше дневного лимита: домен молодой, и рассылка пачкой сожжёт его
   репутацию вместе с письмами клиентам. Ответы тем, кто нам написал, уходят
   сразу по кнопке — это переписка, а не рассылка.

   Безопасность. Текст входящих писем — недоверенные данные. Ни одно письмо
   не уходит без нажатия кнопки человеком, кроме напоминания к уже
   одобренному первому письму, и его можно отменить до отправки.
   ============================================================ */

import { callClaude } from './ai.js';

const FROM = { email: 'partners@estateart.homes', name: 'Estate Art' };
const OB_TTL = 60 * 60 * 24 * 120;        // исходящие храним четыре месяца
const MODEL = 'claude-haiku-5-5';

export const STAGES = {
  queued: '🕓 в очереди',
  sent: '📨 написали',
  replied: '💬 ответили',
  terms: '💼 условия',
  objects: '📦 объекты',
  listed: '✅ на сайте',
  declined: '⛔ отказ',
};
const ORDER = ['queued', 'sent', 'replied', 'terms', 'objects', 'listed'];

/* ---------- мелочи ---------- */

const ptKey = email => `pt:${email}`;
const obKey = id => `ob:${id}`;

export function bareEmail(v) {
  const s = String(v || '');
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function newId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

function num(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

/** Не понижаем этап: ответ после условий не должен откатить партнёра назад. */
function advance(cur, next) {
  if (next === 'declined') return 'declined';
  const a = ORDER.indexOf(cur), b = ORDER.indexOf(next);
  return b > a ? next : cur || next;
}

/* Ссылки, по которым обычно отдают объекты: папки, таблицы, архивы. */
const SHARE_RE = /https?:\/\/(?:drive\.google\.com|docs\.google\.com|(?:www\.)?dropbox\.com|we\.tl|(?:www\.)?wetransfer\.com|1drv\.ms|onedrive\.live\.com|mega\.nz|disk\.yandex\.\w+|yadi\.sk|(?:www\.)?icloud\.com|(?:www\.)?mediafire\.com|(?:[\w-]+\.)?sharepoint\.com)\/[^\s<>"')\]]+/gi;
const FILE_RE = /\.(zip|rar|7z|xlsx?|csv|pdf|docx?|pptx?)$/i;

export function objectLinks(text) {
  return [...new Set(String(text || '').match(SHARE_RE) || [])].slice(0, 10);
}

export function objectFiles(attachments) {
  return (attachments || []).filter(a => FILE_RE.test(a));
}

/* ---------- партнёры ---------- */

export async function getPartner(env, email) {
  const raw = await env.CHAT.get(ptKey(email));
  return raw ? JSON.parse(raw) : null;
}

export async function savePartner(env, p) {
  p.history = (p.history || []).slice(-30);
  await env.CHAT.put(ptKey(p.email), JSON.stringify(p), {
    // метаданные читаются списком, без отдельного запроса на каждого
    metadata: {
      s: p.stage, n: String(p.name || '').slice(0, 60),
      lo: p.lastOut || '', li: p.lastIn || '', r: p.reminders || 0, o: p.optOut ? 1 : 0,
    },
  });
}

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.CHAT.list({ prefix, cursor, limit: 1000 });
    out.push(...r.keys);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

/* ---------- входящее письмо от партнёра ---------- */

/**
 * Вызывается из mail.js после разбора письма. Если отправитель уже в воронке
 * или модель отнесла письмо к партнёрским — обновляет этап и, если пришли
 * условия или объекты, присылает админам отдельное уведомление.
 */
export async function onIncomingMail(env, deps, mail, digest, mailId) {
  const email = bareEmail(mail.replyTo || mail.from);
  if (!email || email.endsWith('@estateart.homes')) return;
  let p = await getPartner(env, email);
  const isPartner = digest && digest.category === 'партнёр';
  if (!p && !isPartner) return;

  const now = new Date().toISOString();
  if (!p) {
    p = {
      email, name: (digest && digest.company) || mail.from.replace(/<[^>]*>/, '').trim() || email,
      stage: 'replied', source: 'входящее письмо', createdAt: now, history: [],
    };
  }
  const links = objectLinks(mail.text);
  const files = objectFiles(mail.attachments);
  const hasObjects = links.length > 0 || files.length > 0 || !!(digest && digest.objects);
  const terms = digest && digest.terms ? String(digest.terms).trim() : '';
  const declined = !!(digest && digest.optout);

  let next = 'replied';
  if (terms) next = 'terms';
  if (hasObjects) next = 'objects';
  if (declined) next = 'declined';
  const before = p.stage;
  p.stage = advance(p.stage, next);
  p.lastIn = now;
  p.lastMessageId = mail.messageId || p.lastMessageId;
  p.lastSubject = mail.subject;
  if (terms) p.terms = terms;
  if (declined) p.optOut = true;
  if (hasObjects) {
    p.objects = [...(p.objects || []), { at: now, links, files, mailId }].slice(-10);
  }
  p.history.push({ at: now, dir: 'in', subject: mail.subject, summary: digest ? digest.summary : '', mailId });
  await savePartner(env, p);

  // Партнёр ответил — запланированное напоминание больше не нужно
  await cancelReminders(env, email);

  const esc = deps.esc;
  const who = `<b>${esc(p.name)}</b> · <code>${esc(email)}</code>`;
  const notes = [];
  if (terms) {
    notes.push(`💼 <b>Условия от партнёра</b>\n${who}\n\n${esc(terms)}`);
  }
  if (hasObjects) {
    let t = `📦 <b>Партнёр прислал объекты</b>\n${who}`;
    if (links.length) t += '\n\n' + links.map(l => `• ${esc(l)}`).join('\n');
    if (files.length) t += `\n\n<i>Вложения: ${esc(files.join(', '))}</i>`;
    t += `\n\nРазобрать в черновики карточек:\n<code>python3 tools/partners/import_objects.py --partner ${esc(email)}</code>`;
    notes.push(t);
  }
  if (declined && before !== 'declined') {
    notes.push(`⛔ <b>Партнёр отказался или попросил не писать</b>\n${who}\nБольше писем и напоминаний ему не будет.`);
  }
  for (const text of notes) {
    await broadcast(env, deps, { text, parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

async function broadcast(env, deps, payload) {
  const chats = deps.chats(env);
  await Promise.allSettled(chats.map(chat_id => deps.tg(env, 'sendMessage', { ...payload, chat_id })));
}

/* ---------- исходящие ---------- */

/**
 * Создать исходящее письмо. status: 'pending' — ждёт одобрения,
 * 'approved' — стоит в очереди cron, 'draft' — отправляется кнопкой сразу.
 */
export async function createOutbox(env, o) {
  const id = o.id || newId();
  const rec = {
    id, to: bareEmail(o.to), name: o.name || '', subject: o.subject, text: o.text,
    translation: o.translation || '', kind: o.kind || 'reply',
    inReplyTo: o.inReplyTo || '', references: o.references || '',
    status: o.status || 'draft', notBefore: o.notBefore || 0,
    createdAt: new Date().toISOString(),
  };
  await putOutbox(env, rec);
  return rec;
}

async function putOutbox(env, rec) {
  await env.CHAT.put(obKey(rec.id), JSON.stringify(rec), { expirationTtl: OB_TTL });
  // индексы: ожидающие одобрения и одобренные в очереди
  const t = Date.parse(rec.createdAt) || Date.now();
  const pKey = `obp:${t}:${rec.id}`, qKey = `obq:${String(rec.notBefore || t).padStart(13, '0')}:${rec.id}`;
  if (rec.status === 'pending') await env.CHAT.put(pKey, rec.id, { expirationTtl: OB_TTL });
  else await env.CHAT.delete(pKey);
  if (rec.status === 'approved') await env.CHAT.put(qKey, rec.id, { expirationTtl: OB_TTL });
  else await env.CHAT.delete(qKey);
}

export async function getOutbox(env, id) {
  const raw = id && await env.CHAT.get(obKey(id));
  return raw ? JSON.parse(raw) : null;
}

const RETRY = new Set([
  'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_PLAN_RESTRICTED',
  'E_DAILY_LIMIT_EXCEEDED', 'E_RATE_LIMIT_EXCEEDED', 'E_SENDER_NOT_VERIFIED',
]);

function emailError(e) {
  const code = e && e.code;
  const map = {
    E_SENDER_DOMAIN_NOT_AVAILABLE: 'отправка с estateart.homes ещё не включена в Cloudflare Email Sending',
    E_RECIPIENT_NOT_ALLOWED: 'домен не подключён к Email Sending: писать можно только на подтверждённые адреса',
    E_RECIPIENT_PLAN_RESTRICTED: 'на бесплатном тарифе Workers можно писать только на подтверждённые адреса — нужен Workers Paid',
    E_DAILY_LIMIT_EXCEEDED: 'исчерпан дневной лимит Cloudflare',
    E_RATE_LIMIT_EXCEEDED: 'слишком часто, Cloudflare просит подождать',
    E_DELIVERY_FAILED: 'сервер получателя не принял письмо',
  };
  return (code && map[code] ? `${map[code]} (${code})` : '') || (e && e.message) || 'неизвестная ошибка';
}

/** Отправить письмо. Ответы партнёрам уходят со скрытой копией в обычные ящики из
    MAIL_FORWARD_TO — чтобы переписка была и в почте. Рассылка (первые письма и
    напоминания) — без копии: её видно карточками в Telegram, а сотня одинаковых
    писем незнакомым адресатам в почте только мешает. Какие виды писем копировать —
    OUTBOX_BCC_KINDS через запятую. */
export async function sendOutbox(env, deps, rec) {
  if (!env.EMAIL) throw new Error('в wrangler.toml нет привязки send_email');
  const p = await getPartner(env, rec.to);
  if (p && p.optOut && rec.kind !== 'reply') {
    rec.status = 'cancelled';
    rec.error = 'партнёр попросил не писать';
    await putOutbox(env, rec);
    return { ok: false, error: rec.error };
  }
  const headers = {};
  if (rec.inReplyTo) {
    headers['In-Reply-To'] = rec.inReplyTo;
    headers['References'] = rec.references || rec.inReplyTo;
  }
  const copyKinds = String(env.OUTBOX_BCC_KINDS ?? 'reply').split(',').map(s => s.trim());
  const bcc = copyKinds.includes(rec.kind)
    ? String(env.MAIL_FORWARD_TO || '').split(',').map(s => s.trim()).filter(Boolean) : [];
  try {
    const res = await env.EMAIL.send({
      from: FROM, to: rec.to, replyTo: FROM.email,
      ...(bcc.length ? { bcc } : {}),
      subject: rec.subject, text: rec.text,
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    const now = new Date().toISOString();
    rec.status = 'sent';
    rec.sentAt = now;
    rec.messageId = res && res.messageId;
    await putOutbox(env, rec);
    await bumpDay(env);
    if (!(await env.CHAT.get('obfirst'))) await env.CHAT.put('obfirst', now);

    const partner = p || { email: rec.to, name: rec.name || rec.to, stage: 'sent', createdAt: now, history: [] };
    partner.stage = advance(partner.stage === 'queued' ? 'sent' : partner.stage, 'sent');
    partner.lastOut = now;
    if (rec.kind === 'first') partner.firstSubject = rec.subject;
    if (rec.kind === 'first') partner.firstMessageId = rec.messageId ? `<${String(rec.messageId).replace(/[<>]/g, '')}>` : '';
    if (rec.kind === 'reminder') partner.reminders = (partner.reminders || 0) + 1;
    partner.history = [...(partner.history || []), { at: now, dir: 'out', subject: rec.subject, kind: rec.kind }];
    await savePartner(env, partner);
    return { ok: true };
  } catch (e) {
    console.error('email send', e && e.code, e && e.message);
    // Настройка или лимит, а не плохой адрес: письмо остаётся в очереди и
    // уйдёт, когда отправку включат или лимит обнулится
    const retry = RETRY.has(e && e.code) || !(e && e.code);
    rec.status = rec.kind === 'reply' ? 'draft' : retry ? 'approved' : 'failed';
    rec.error = emailError(e);
    await putOutbox(env, rec);
    return { ok: false, error: rec.error, retry };
  }
}

/* ---------- дневной счётчик и рабочие часы ---------- */

function vnNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);   // Вьетнам: UTC+7, без перехода на летнее время
}
const dayKey = () => `obday:${vnNow().toISOString().slice(0, 10)}`;

/* Дневной лимит разгоняется сам: OUTREACH_DAILY = "10,20,30,40" — по числу на
   неделю, считая от первого отправленного письма (ключ obfirst). Репутация
   домена растёт от истории отправок, а не от даты регистрации: первую неделю
   рассылки почтовики смотрят на нас особенно придирчиво. Одно число — без разгона. */
async function dailyLimit(env) {
  const steps = String(env.OUTREACH_DAILY || '10').split(',').map(x => num(x, 0)).filter(Boolean);
  if (steps.length < 2) return steps[0] || 10;
  const first = Date.parse(await env.CHAT.get('obfirst') || '') || Date.now();
  const week = Math.floor((Date.now() - first) / (7 * 86400 * 1000));
  return steps[Math.min(week, steps.length - 1)];
}

async function sentToday(env) {
  return num(await env.CHAT.get(dayKey()), 0);
}
async function bumpDay(env) {
  const n = await sentToday(env);
  await env.CHAT.put(dayKey(), String(n + 1), { expirationTtl: 60 * 60 * 48 });
}

function workingHours(env) {
  const d = vnNow();
  const h = d.getUTCHours(), wd = d.getUTCDay();
  const from = num(env.OUTREACH_FROM_HOUR, 8), to = num(env.OUTREACH_TO_HOUR, 18);
  return wd !== 0 && h >= from && h < to;              // пн–сб, 8:00–18:00 по Вьетнаму
}

/* ---------- карточки в Telegram ---------- */

const KIND = { first: 'Первое письмо', reminder: 'Напоминание', reply: 'Ответ' };

export function outboxCard(rec, esc, note = '') {
  let t = `✉️ <b>${KIND[rec.kind] || 'Письмо'}</b>` + (rec.name ? ` · ${esc(rec.name)}` : '') +
    `\n<b>Кому:</b> <code>${esc(rec.to)}</code>` +
    `\n<b>Тема:</b> ${esc(rec.subject)}` +
    `\n\n<pre>${esc(rec.text.slice(0, 2600))}</pre>`;
  if (rec.translation) t += `\n<b>Перевод:</b>\n<i>${esc(rec.translation.slice(0, 900))}</i>`;
  if (note) t += `\n\n${note}`;
  t += `\n<code>@${rec.id}</code>`;
  return t.slice(0, 4096);
}

function outboxKeyboard(rec) {
  if (rec.status === 'sent') return { inline_keyboard: [[{ text: '✅ Отправлено', callback_data: 'ob:n' }]] };
  if (rec.status === 'cancelled') return { inline_keyboard: [[{ text: '🗑 Отменено', callback_data: 'ob:n' }]] };
  if (rec.status === 'approved') {
    return { inline_keyboard: [[
      { text: '🕓 В очереди', callback_data: 'ob:n' },
      { text: '🗑 Отменить', callback_data: `ob:c:${rec.id}` },
    ]] };
  }
  if (rec.status === 'pending') {
    return { inline_keyboard: [
      [{ text: '✅ Одобрить', callback_data: `ob:a:${rec.id}` }, { text: '🗑 Не писать', callback_data: `ob:c:${rec.id}` }],
      [{ text: '➡️ Следующее', callback_data: 'ob:v' }, { text: '✅ Одобрить все', callback_data: 'ob:A' }],
    ] };
  }
  return { inline_keyboard: [[
    { text: '📤 Отправить', callback_data: `ob:s:${rec.id}` },
    { text: '🗑 Отменить', callback_data: `ob:c:${rec.id}` },
  ]] };
}

const EDIT_HINT = '<i>Поправить: ответьте реплаем на эту карточку. По-русски — как указание («короче», «спроси про продажу»), на языке письма — готовым текстом.</i>';

/** Показать карточку письма и запомнить, какой карточке какое письмо соответствует (для правки реплаем). */
export async function postOutbox(env, deps, chatId, rec, extra = {}) {
  const note = rec.status === 'draft' || rec.status === 'pending' ? EDIT_HINT : '';
  const r = await deps.tg(env, 'sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true,
    text: outboxCard(rec, deps.esc, rec.error ? `⚠️ ${deps.esc(rec.error)}\n${note}` : note),
    reply_markup: outboxKeyboard(rec), ...extra,
  });
  if (r && r.ok && r.result) {
    await env.CHAT.put(`obm:${chatId}:${r.result.message_id}`, rec.id, { expirationTtl: OB_TTL });
  }
  return r;
}

async function refreshCard(env, deps, cq, rec, note = '') {
  await deps.tg(env, 'editMessageText', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
    parse_mode: 'HTML', disable_web_page_preview: true,
    text: outboxCard(rec, deps.esc, note),
    reply_markup: outboxKeyboard(rec),
  });
}

/* ---------- кнопки ob:* ---------- */

export async function handleOutboxCallback(cq, env, deps) {
  const chatId = String(cq.message && cq.message.chat && cq.message.chat.id);
  if (!deps.chats(env).includes(chatId) && !deps.managers(env).includes(chatId)) {
    await deps.tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа' });
    return;
  }
  const [, kind, id] = String(cq.data || '').split(':');
  const ack = (text, alert) => deps.tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: !!alert });

  if (kind === 'n') return ack();
  if (kind === 'v') { await ack(); return showNextPending(env, deps, chatId); }
  if (kind === 'A') {
    const n = await approveAll(env);
    await ack(n ? `Одобрено: ${n}. Уйдут по расписанию.` : 'Нечего одобрять', true);
    return;
  }

  const rec = await getOutbox(env, id);
  if (!rec) return ack('Письмо не найдено — возможно, оно старше четырёх месяцев', true);

  if (kind === 'c') {
    rec.status = 'cancelled';
    await putOutbox(env, rec);
    if (rec.kind === 'first') {
      const p = await getPartner(env, rec.to);
      if (p && p.stage === 'queued') { p.stage = 'declined'; p.note = 'решили не писать'; await savePartner(env, p); }
    }
    await ack('Отменено');
    await refreshCard(env, deps, cq, rec);
    return;
  }
  if (kind === 'a') {
    if (rec.status !== 'pending') return ack('Уже обработано');
    rec.status = 'approved';
    await putOutbox(env, rec);
    await ack('Одобрено — уйдёт по расписанию');
    await refreshCard(env, deps, cq, rec);
    return showNextPending(env, deps, chatId);
  }
  if (kind === 's') {
    if (rec.status === 'sent') return ack('Уже отправлено');
    await ack('Отправляю…');
    const r = await sendOutbox(env, deps, rec);
    await refreshCard(env, deps, cq, rec, r.ok ? '' : `⚠️ Не отправлено: ${deps.esc(r.error)}`);
    if (r.ok) {
      const others = deps.chats(env).filter(c => c !== chatId);
      await Promise.allSettled(others.map(c => deps.tg(env, 'sendMessage', {
        chat_id: c, parse_mode: 'HTML',
        text: `📤 Ушло письмо на <code>${deps.esc(rec.to)}</code>: ${deps.esc(rec.subject)}`,
      })));
    }
    return;
  }
  return ack();
}

async function approveAll(env) {
  let n = 0;
  for (const k of await listAll(env, 'obp:')) {
    const rec = await getOutbox(env, await env.CHAT.get(k.name));
    if (rec && rec.status === 'pending') { rec.status = 'approved'; await putOutbox(env, rec); n++; }
    else await env.CHAT.delete(k.name);
  }
  return n;
}

export async function showNextPending(env, deps, chatId) {
  for (const k of await listAll(env, 'obp:')) {
    const rec = await getOutbox(env, await env.CHAT.get(k.name));
    if (rec && rec.status === 'pending') return postOutbox(env, deps, chatId, rec);
    await env.CHAT.delete(k.name);
  }
  return deps.tg(env, 'sendMessage', { chat_id: chatId, text: 'Писем на одобрение больше нет.' });
}

/* ---------- правка письма реплаем ---------- */

const REWRITE_TOOL = {
  name: 'rewrite',
  description: 'Исправленное письмо',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      text: { type: 'string', description: 'Письмо на том же языке, что и было' },
      translation: { type: 'string', description: 'Перевод письма на русский' },
    },
    required: ['subject', 'text', 'translation'],
  },
};

/** Реплай админа на карточку письма. true — сообщение обработано здесь. */
export async function handleOutboxReply(message, env, deps) {
  const reply = message.reply_to_message;
  if (!reply) return false;
  const id = await env.CHAT.get(`obm:${message.chat.id}:${reply.message_id}`);
  if (!id) return false;
  const rec = await getOutbox(env, id);
  if (!rec || ['sent', 'cancelled'].includes(rec.status)) {
    await deps.tg(env, 'sendMessage', { chat_id: message.chat.id, text: 'Это письмо уже отправлено или отменено — править нечего.' });
    return true;
  }
  const said = String(message.text || '').trim();
  const cyr = (said.match(/[а-яё]/gi) || []).length;
  if (cyr > said.length * 0.3) {
    // По-русски — это указание, а не текст письма
    await deps.tg(env, 'sendChatAction', { chat_id: message.chat.id, action: 'typing' });
    try {
      const res = await callClaude(env, [{ role: 'user', content:
        `Письмо:\nТема: ${rec.subject}\n\n${rec.text}\n\nЧто исправить (указание владельца агентства): ${said}` }],
      'Ты редактируешь деловое письмо агентства недвижимости Estate Art брокеру или застройщику. ' +
      'Внеси исправление владельца, сохрани язык письма, вежливый деловой тон и подпись. ' +
      'Не добавляй фактов, цифр комиссии и обещаний, которых нет в письме или в указании.',
      { tools: [REWRITE_TOOL], toolChoice: { type: 'tool', name: 'rewrite' }, maxTokens: 2000, model: MODEL });
      const c = (res.content || []).find(x => x.type === 'tool_use');
      if (!c) throw new Error('пустой ответ');
      Object.assign(rec, { subject: c.input.subject, text: c.input.text, translation: c.input.translation });
    } catch (e) {
      await deps.tg(env, 'sendMessage', { chat_id: message.chat.id, text: 'Не получилось переписать письмо — попробуйте ещё раз.' });
      return true;
    }
  } else {
    rec.text = said;
    rec.translation = '(текст вписан вручную)';
  }
  rec.error = '';
  await putOutbox(env, rec);
  await postOutbox(env, deps, message.chat.id, rec, { reply_to_message_id: message.message_id });
  return true;
}

/* ---------- напоминания ---------- */

/* Тексты напоминаний на каждом языке лежат в KV под ключами tpl:reminder:<язык>
   ({"text": ..., "translation": ...}) и заливаются из data/outreach скриптом
   tools/outreach/queue.py: репозиторий публичный, переписке с партнёрами здесь
   не место. Запасной вариант — нейтральный английский без имён. */
const REMINDER_FALLBACK = {
  text: `Hello,

Just a short follow-up to our partnership proposal from Estate Art last week. If it is of interest, a brief reply with your terms, or your property list (ideally a zip archive with photos and descriptions), is all we need to list your properties on our website.

If you would rather not hear from us, just reply "no" and we will not write again.

Kind regards,
Estate Art — https://estateart.homes`,
  translation: 'Короткое напоминание о предложении сотрудничества (запасной английский текст: шаблон на языке партнёра не найден в KV).',
};

async function reminderText(env, lang) {
  for (const l of [lang, 'en']) {
    const raw = l && await env.CHAT.get(`tpl:reminder:${l}`);
    if (raw) { try { return JSON.parse(raw); } catch { /* битый шаблон — берём следующий */ } }
  }
  return REMINDER_FALLBACK;
}

async function cancelReminders(env, email) {
  for (const k of await listAll(env, 'obq:')) {
    const rec = await getOutbox(env, await env.CHAT.get(k.name));
    if (rec && rec.to === email && rec.kind === 'reminder' && rec.status === 'approved') {
      rec.status = 'cancelled';
      rec.error = 'партнёр ответил';
      await putOutbox(env, rec);
    }
  }
}

async function planReminders(env, deps) {
  const days = num(env.REMIND_AFTER_DAYS, 5);
  const delayH = num(env.REMIND_DELAY_HOURS, 6);
  const cutoff = Date.now() - days * 86400 * 1000;
  for (const k of await listAll(env, 'pt:')) {
    const m = k.metadata || {};
    if (m.s !== 'sent' || m.li || m.o || (m.r || 0) >= 1 || !m.lo || Date.parse(m.lo) > cutoff) continue;
    const p = await getPartner(env, k.name.slice(3));
    if (!p || p.reminderPlanned) continue;
    const tpl = await reminderText(env, p.lang);
    const rec = await createOutbox(env, {
      to: p.email, name: p.name, kind: 'reminder', status: 'approved',
      subject: `Re: ${p.firstSubject || 'Partnership proposal — Estate Art'}`,
      text: tpl.text, translation: tpl.translation || '',
      inReplyTo: p.firstMessageId || '', notBefore: Date.now() + delayH * 3600 * 1000,
    });
    p.reminderPlanned = rec.id;
    await savePartner(env, p);
    for (const chat of deps.chats(env)) {
      await postOutbox(env, deps, chat, rec, { disable_notification: true });
    }
  }
}

/* ---------- очередь: cron раз в полчаса ---------- */

async function sendDue(env, deps) {
  if (!workingHours(env)) return;
  const daily = await dailyLimit(env);
  // Cron раз в полчаса: слотов в день — два на рабочий час. Если лимит больше
  // числа слотов, за запуск уходит несколько писем, а не одно.
  const slots = Math.max(1, (num(env.OUTREACH_TO_HOUR, 18) - num(env.OUTREACH_FROM_HOUR, 8)) * 2);
  const perTick = Math.max(num(env.OUTREACH_PER_TICK, 1), Math.ceil(daily / slots));
  let left = Math.min(perTick, daily - await sentToday(env));
  if (left <= 0) return;
  for (const k of await listAll(env, 'obq:')) {
    if (left <= 0) break;
    const due = parseInt(k.name.split(':')[1], 10);
    if (due > Date.now()) break;              // ключи отсортированы по времени
    const rec = await getOutbox(env, await env.CHAT.get(k.name));
    if (!rec || rec.status !== 'approved') { await env.CHAT.delete(k.name); continue; }
    const r = await sendOutbox(env, deps, rec);
    left--;
    if (!r.ok) {
      // Об одной и той же причине — не чаще раза в сутки, а не каждые полчаса
      const noteKey = `obwarn:${r.error}`.slice(0, 480);
      if (!(await env.CHAT.get(noteKey))) {
        await env.CHAT.put(noteKey, '1', { expirationTtl: 86400 });
        await broadcast(env, deps, {
          parse_mode: 'HTML',
          text: `⚠️ Письмо на <code>${deps.esc(rec.to)}</code> не ушло: ${deps.esc(r.error)}\n` +
                (r.retry ? 'Оно и остальные ждут в очереди и уйдут сами, как только отправка заработает.'
                         : 'Это письмо снято с очереди, остальные пойдут дальше.'),
        });
      }
      if (r.retry) break;
    }
  }
}

/* Первые письма собраны из шаблонов, которые владельцы уже утвердили, — при
   OUTREACH_AUTO_APPROVE=1 они встают в очередь сами, без кнопки «Одобрить».
   Ответы, написанные моделью, по-прежнему уходят только по «📤 Отправить». */
async function autoApprove(env) {
  if (env.OUTREACH_AUTO_APPROVE !== '1') return;
  for (const k of await listAll(env, 'obp:')) {
    const rec = await getOutbox(env, await env.CHAT.get(k.name));
    if (!rec || rec.status !== 'pending') { await env.CHAT.delete(k.name); continue; }
    if (rec.kind === 'first') { rec.status = 'approved'; await putOutbox(env, rec); }
  }
}

async function notifyPending(env, deps) {
  const n = (await listAll(env, 'obp:')).length;
  const seen = num(await env.CHAT.get('obp:seen'), 0);
  if (n > seen) {
    await broadcast(env, deps, {
      text: `📝 Новые письма партнёрам ждут одобрения: ${n}.`,
      reply_markup: { inline_keyboard: [[
        { text: '👀 Смотреть по одному', callback_data: 'ob:v' },
        { text: '✅ Одобрить все', callback_data: 'ob:A' },
      ]] },
    });
  }
  if (n !== seen) await env.CHAT.put('obp:seen', String(n));
}

export async function runSchedule(env, deps) {
  for (const step of [autoApprove, notifyPending, planReminders, sendDue]) {
    try { await step(env, deps); } catch (e) { console.error('schedule', step.name, e && e.stack || e); }
  }
}

/* ---------- команды /partners и /queue ---------- */

export async function partnersReport(env, deps) {
  const keys = await listAll(env, 'pt:');
  const by = {};
  for (const k of keys) {
    const s = (k.metadata && k.metadata.s) || 'replied';
    (by[s] = by[s] || []).push(k);
  }
  const esc = deps.esc;
  let t = `<b>Партнёры: ${keys.length}</b>\n`;
  for (const s of [...ORDER, 'declined']) {
    if (!by[s]) continue;
    t += `\n${STAGES[s]}: <b>${by[s].length}</b>`;
    if (['replied', 'terms', 'objects'].includes(s)) {
      t += '\n' + by[s].slice(0, 8).map(k => `  • ${esc(k.metadata.n || k.name.slice(3))}`).join('\n');
    }
  }
  const q = (await listAll(env, 'obq:')).length, p = (await listAll(env, 'obp:')).length;
  t += `\n\n<b>Очередь:</b> одобрено ${q}, ждут одобрения ${p}, отправлено сегодня ${await sentToday(env)} из ${await dailyLimit(env)}`;
  return t.slice(0, 4096);
}

export async function queueKeyboard(env) {
  return { inline_keyboard: [[
    { text: '👀 Смотреть по одному', callback_data: 'ob:v' },
    { text: '✅ Одобрить все', callback_data: 'ob:A' },
  ]] };
}
