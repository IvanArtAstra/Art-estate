/* ============================================================
   Estate Art — Единый резолвер контактов, аккаунтов, компаний и заявок.

   Модуль не импортирует другие модули bot/ (без циклических зависимостей).
   Определяет email, телефон, @telegram и название компании из текста и
   профилей, связывает их с аккаунтами личного кабинета (usr:*), их
   объектами (prop:*), базой партнёров (pt:*) и историей обращений (crm:*).
   ============================================================ */

const CRM_TTL = 60 * 60 * 24 * 180; // 180 дней

const ROLE_LABEL = {
  buyer: 'Покупатель / Инвестор',
  renter: 'Арендатор',
  owner: 'Собственник',
  partner: 'Агент / Застройщик',
};

const STATUS_LABEL = {
  approved: 'опубликован на сайте',
  pending: 'на проверке',
  rejected: 'отклонён',
  draft: 'черновик',
};

const clean = (v, max = 200) =>
  String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

export function normEmail(raw) {
  const s = clean(raw, 160).toLowerCase();
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : '';
}

export function normPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return '';
  return digits;
}

export function phoneTail(digits) {
  const d = normPhone(digits);
  if (!d) return '';
  return d.length >= 10 ? d.slice(-10) : d;
}

export function normTg(raw) {
  const s = clean(raw, 80).toLowerCase();
  const m = s.match(/(?:t\.me\/|@)([a-z][a-z0-9_]{3,31})/);
  if (m) return '@' + m[1];
  if (/^[a-z][a-z0-9_]{3,31}$/.test(s)) return '@' + s;
  return '';
}

export function normCompany(raw) {
  const cleaned = clean(raw, 120)
    .toLowerCase()
    .replace(/[«»"'`.,\-_()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = new Set([
    'ооо', 'ип', 'зао', 'оао', 'пао', 'ао', 'llc', 'ltd', 'inc', 'co',
    'corp', 'gmbh', 'company', 'agency', 'realty', 'estate', 'group',
    'агентство', 'компания', 'застройщик',
  ]);
  return cleaned
    .split(' ')
    .filter(w => w && !stop.has(w))
    .join('');
}

function maskEmail(e) {
  const s = String(e || '');
  const i = s.indexOf('@');
  if (i < 2) return '***';
  return s[0] + '***' + s.slice(i);
}

function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return '***' + d.slice(-4);
}

/* ---------- Извлечение контактов из текста и полей ---------- */

export function extractContacts(text = '', extra = {}) {
  const combined = [
    text,
    extra.contact,
    extra.email,
    extra.phone,
    extra.telegram,
    extra.login,
  ].filter(Boolean).join('\n');

  const emails = new Set();
  const phones = new Set();
  const phoneLast10 = new Set();
  const telegrams = new Set();

  // 1. Emails
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = emailRe.exec(combined)) !== null) {
    emails.add(m[0].toLowerCase());
  }
  if (extra.email) {
    const e = normEmail(extra.email);
    if (e) emails.add(e);
  }

  // 2. Phones (защищаемся от дат YYYY-MM-DD и круглых цен)
  const sanitizedForPhones = combined
    .replace(/\b\d{4}[-/.]\d{2}[-/.]\d{2}\b/g, ' ')
    .replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, ' ');

  // С форматом (+ / пробелы / скобки / дефисы)
  const phoneFormattedRe = /(?:\+\d{1,3}|8)[\s()-]*(?:\d[\s()-]*){8,13}\d/g;
  while ((m = phoneFormattedRe.exec(sanitizedForPhones)) !== null) {
    const rawMatch = m[0].trim();
    const digits = normPhone(rawMatch);
    if (!digits) continue;
    // Отсекаем круглые суммы с кучей нулей без плюса, например 8 000 000 000
    if (!rawMatch.startsWith('+') && /^(\d)0{7,}$/.test(digits)) continue;
    phones.add(digits);
    const tail = phoneTail(digits);
    if (tail) phoneLast10.add(tail);
  }

  // Сплошные номера от 10 до 12 цифр с правдоподобным кодом (или явное поле phone)
  const phonePlainRe = /(?<![\d.])(?:79\d{9}|89\d{9}|66\d{8,9}|84\d{8,10}|971\d{8,9}|90\d{10}|995\d{9}|375\d{9}|380\d{9}|998\d{9})(?![\d.])/g;
  while ((m = phonePlainRe.exec(sanitizedForPhones)) !== null) {
    const digits = normPhone(m[0]);
    if (digits) {
      phones.add(digits);
      const tail = phoneTail(digits);
      if (tail) phoneLast10.add(tail);
    }
  }
  if (extra.phone) {
    const d = normPhone(extra.phone);
    if (d) {
      phones.add(d);
      const t = phoneTail(d);
      if (t) phoneLast10.add(t);
    }
  }

  // 3. Telegram handles (@username и t.me/username)
  // Убираем email, чтобы домен после @ не читался как @handle
  const withoutEmails = combined.replace(emailRe, ' ');
  const tgAtRe = /(?:^|[\s(,;:])@([a-zA-Z][a-zA-Z0-9_]{3,31})\b/g;
  while ((m = tgAtRe.exec(withoutEmails)) !== null) {
    telegrams.add('@' + m[1].toLowerCase());
  }
  const tgUrlRe = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z][a-zA-Z0-9_]{3,31})\b/gi;
  while ((m = tgUrlRe.exec(withoutEmails)) !== null) {
    telegrams.add('@' + m[1].toLowerCase());
  }
  if (extra.telegram) {
    const t = normTg(extra.telegram);
    if (t) telegrams.add(t);
  }

  // 4. Компания
  let company = clean(extra.company, 120);
  if (!company && text) {
    const compMatch =
      text.match(/(?:компани[яию]|агентств[оау]|застройщик[ау]?|company|agency|developer)\s*[:—-]?\s*[«"']([^»"'\n]{2,50})[»"']/i) ||
      text.match(/\b(?:ООО|ИП|ЗАО|ОАО|АО)\s*[«"']([^»"'\n]{2,50})[»"']/) ||
      text.match(/(?:компани[яию]|агентств[оау]|застройщик[ау]?|company|agency|developer)\s*[:—-]\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s&.-]{1,40})/i);
    if (compMatch && compMatch[1]) {
      company = clean(compMatch[1], 80);
    }
  }

  return {
    emails: Array.from(emails),
    phones: Array.from(phones),
    phoneLast10: Array.from(phoneLast10),
    telegrams: Array.from(telegrams),
    telegramChatId: clean(extra.telegramChatId, 32),
    company,
  };
}

/* ---------- Индексация контактов аккаунта в KV ---------- */

export async function indexUserContacts(env, user) {
  if (!env || !env.CHAT || !user || !user.id) return;
  const ex = extractContacts('', {
    email: user.email,
    phone: user.phone,
    telegram: user.telegram,
    login: user.login,
    contact: user.contact,
    company: user.company,
    telegramChatId: user.telegramChatId,
  });

  const puts = [];
  for (const e of ex.emails) {
    puts.push(env.CHAT.put('usr_idx:email:' + e, user.id));
  }
  for (const d of ex.phones) {
    puts.push(env.CHAT.put('usr_idx:phone:' + d, user.id));
  }
  for (const t10 of ex.phoneLast10) {
    puts.push(env.CHAT.put('usr_idx:p10:' + t10, user.id));
  }
  for (const tg of ex.telegrams) {
    puts.push(env.CHAT.put('usr_idx:tg:' + tg.slice(1), user.id));
  }
  if (ex.telegramChatId) {
    puts.push(env.CHAT.put('usr_idx:tgid:' + ex.telegramChatId, user.id));
  }
  const nc = normCompany(user.company);
  if (nc && nc.length >= 2) {
    const cKey = 'usr_idx:company:' + nc;
    const prevRaw = await env.CHAT.get(cKey);
    let ids = [];
    if (prevRaw) {
      try {
        const parsed = JSON.parse(prevRaw);
        ids = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        ids = [String(prevRaw)];
      }
    }
    if (!ids.includes(user.id)) ids.unshift(user.id);
    puts.push(env.CHAT.put(cKey, JSON.stringify(ids.slice(0, 5))));
  }
  await Promise.all(puts);
}

export async function linkTelegramChatToUser(env, chatId, userId) {
  if (!env || !env.CHAT || !chatId || !userId) return null;
  const cid = String(chatId);
  await env.CHAT.put('usr_idx:tgid:' + cid, userId);
  const raw = await env.CHAT.get('usr:' + userId);
  if (!raw) return null;
  const user = JSON.parse(raw);
  if (user.telegramChatId !== cid) {
    user.telegramChatId = cid;
    user.updatedAt = new Date().toISOString();
    await env.CHAT.put('usr:' + userId, JSON.stringify(user));
  }
  return user;
}

/* ---------- Память запросов (CRM) ---------- */

function newCrmId() {
  const arr = new Uint8Array(7);
  crypto.getRandomValues(arr);
  return 'c_' + Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export async function recordInquiry(env, data = {}) {
  if (!env || !env.CHAT) return null;
  const ex = data.contacts || extractContacts(data.text || '', data);
  const keys = [];
  for (const e of ex.emails) keys.push('crm:email:' + e);
  for (const t10 of ex.phoneLast10) keys.push('crm:p10:' + t10);
  for (const tg of ex.telegrams) keys.push('crm:tg:' + tg.slice(1));
  if (ex.telegramChatId) keys.push('crm:tgid:' + ex.telegramChatId);
  if (data.userId) keys.push('crm:uid:' + data.userId);

  if (!keys.length) return null;

  let recId = null;
  for (const k of keys) {
    const hit = await env.CHAT.get(k);
    if (hit) { recId = hit; break; }
  }

  let rec = null;
  if (recId) {
    const raw = await env.CHAT.get('crm_rec:' + recId);
    if (raw) {
      try { rec = JSON.parse(raw); } catch {}
    }
  }
  if (!rec) {
    recId = recId || newCrmId();
    rec = {
      id: recId,
      userId: data.userId || null,
      name: clean(data.name, 80) || '',
      company: ex.company || '',
      role: clean(data.role, 30) || '',
      emails: [],
      phones: [],
      telegrams: [],
      telegramChatId: ex.telegramChatId || '',
      inquiries: [],
    };
  }

  if (data.userId && !rec.userId) rec.userId = data.userId;
  if (data.name && data.name !== 'Гость' && !rec.name) rec.name = clean(data.name, 80);
  if (ex.company && !rec.company) rec.company = ex.company;
  if (data.role && !rec.role) rec.role = clean(data.role, 30);
  if (ex.telegramChatId) rec.telegramChatId = ex.telegramChatId;

  rec.emails = [...new Set([...(rec.emails || []), ...ex.emails])].slice(0, 10);
  rec.phones = [...new Set([...(rec.phones || []), ...ex.phones])].slice(0, 10);
  rec.telegrams = [...new Set([...(rec.telegrams || []), ...ex.telegrams])].slice(0, 10);

  if (data.summary || data.listingTitle || data.region || data.budget) {
    const item = {
      at: new Date().toISOString(),
      channel: clean(data.channel, 30) || 'site',
      summary: clean(data.summary, 280),
      listingId: clean(data.listingId, 40) || undefined,
      listingTitle: clean(data.listingTitle, 120) || undefined,
      region: clean(data.region, 80) || undefined,
      budget: clean(data.budget, 40) || undefined,
    };
    const last = rec.inquiries[0];
    const dup = last && last.summary === item.summary && last.listingId === item.listingId;
    if (!dup) {
      rec.inquiries = [item, ...(rec.inquiries || [])].slice(0, 15);
    }
  }
  rec.updatedAt = new Date().toISOString();

  await env.CHAT.put('crm_rec:' + recId, JSON.stringify(rec), { expirationTtl: CRM_TTL });
  await Promise.all(keys.map(k => env.CHAT.put(k, recId, { expirationTtl: CRM_TTL })));
  return rec;
}

/* ---------- Поиск и сбор досье ---------- */

async function listAllKeys(env, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.CHAT.list({ prefix, cursor, limit: 1000 });
    out.push(...(r.keys || []));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function findUserByHints(env, hints, ex) {
  if (hints.userId) {
    const raw = await env.CHAT.get('usr:' + hints.userId);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
  }

  const lookupKeys = [];
  if (ex.telegramChatId) lookupKeys.push('usr_idx:tgid:' + ex.telegramChatId);
  for (const e of ex.emails) {
    lookupKeys.push('usr_idx:email:' + e, 'usr_login:' + e);
  }
  for (const d of ex.phones) {
    lookupKeys.push('usr_idx:phone:' + d, 'usr_login:tel:' + d);
  }
  for (const t10 of ex.phoneLast10) {
    lookupKeys.push('usr_idx:p10:' + t10);
  }
  for (const tg of ex.telegrams) {
    lookupKeys.push('usr_idx:tg:' + tg.slice(1), 'usr_login:' + tg);
  }

  for (const k of lookupKeys) {
    const uid = await env.CHAT.get(k);
    if (!uid) continue;
    const raw = await env.CHAT.get('usr:' + uid);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
  }

  // Поиск по компании
  const nc = normCompany(ex.company);
  if (nc && nc.length >= 2) {
    const rawIds = await env.CHAT.get('usr_idx:company:' + nc);
    if (rawIds) {
      let firstId = '';
      try {
        const parsed = JSON.parse(rawIds);
        firstId = Array.isArray(parsed) ? parsed[0] : String(parsed);
      } catch {
        firstId = String(rawIds);
      }
      if (firstId) {
        const raw = await env.CHAT.get('usr:' + firstId);
        if (raw) {
          try { return JSON.parse(raw); } catch {}
        }
      }
    }
  }

  return null;
}

async function loadUserProperties(env, userId) {
  if (!userId) return [];
  const keys = await listAllKeys(env, 'prop:');
  const mine = keys.filter(k => !k.metadata || k.metadata.oid === userId);
  const out = [];
  for (const k of mine) {
    const raw = await env.CHAT.get(k.name);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw);
      if (p && p.ownerId === userId) {
        out.push({
          id: p.id,
          title: p.title,
          deal: p.deal || 'sale',
          country: p.country,
          countryName: p.countryName,
          city: p.city,
          location: p.location,
          type: p.type,
          beds: p.beds,
          area: p.area,
          priceUSD: p.priceUSD,
          rentMonthUSD: p.rentMonthUSD,
          priceOriginal: p.priceOriginal,
          status: p.status || 'pending',
          rejectReason: p.rejectReason || '',
          updatedAt: p.updatedAt,
        });
      }
    } catch {}
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

async function findPartner(env, emails, companyName) {
  for (const e of emails) {
    const raw = await env.CHAT.get('pt:' + e);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
  }
  const nc = normCompany(companyName);
  if (nc && nc.length >= 3) {
    const keys = await listAllKeys(env, 'pt:');
    for (const k of keys) {
      const mdName = k.metadata && k.metadata.n ? normCompany(k.metadata.n) : '';
      if (mdName && (mdName === nc || mdName.includes(nc) || nc.includes(mdName))) {
        const raw = await env.CHAT.get(k.name);
        if (raw) {
          try { return JSON.parse(raw); } catch {}
        }
      }
    }
  }
  return null;
}

async function findCrmRecord(env, ex, userId) {
  const keys = [];
  if (userId) keys.push('crm:uid:' + userId);
  if (ex.telegramChatId) keys.push('crm:tgid:' + ex.telegramChatId);
  for (const e of ex.emails) keys.push('crm:email:' + e);
  for (const t10 of ex.phoneLast10) keys.push('crm:p10:' + t10);
  for (const tg of ex.telegrams) keys.push('crm:tg:' + tg.slice(1));

  for (const k of keys) {
    const recId = await env.CHAT.get(k);
    if (!recId) continue;
    const raw = await env.CHAT.get('crm_rec:' + recId);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
  }
  return null;
}

export async function resolveIdentity(env, hints = {}, opts = {}) {
  const ex = extractContacts(hints.text || '', hints);
  if (!env || !env.CHAT) {
    return { matched: false, verified: !!opts.verified, extracted: ex, user: null, userListings: [], partner: null, crm: null };
  }

  const user = await findUserByHints(env, hints, ex);
  const allEmails = new Set(ex.emails);
  if (user) {
    const uex = extractContacts('', user);
    uex.emails.forEach(e => allEmails.add(e));
  }

  const [userListings, partner, crm] = await Promise.all([
    user ? loadUserProperties(env, user.id) : Promise.resolve([]),
    findPartner(env, Array.from(allEmails), ex.company || (user && user.company)),
    findCrmRecord(env, ex, user && user.id),
  ]);

  const matched = !!(user || partner || crm);
  return {
    matched,
    verified: !!opts.verified,
    extracted: ex,
    user: user ? {
      id: user.id,
      name: user.name,
      role: user.role || 'buyer',
      company: user.company || '',
      email: user.email || '',
      phone: user.phone || '',
      telegram: user.telegram || '',
      contact: user.contact || user.login || '',
      geo: user.geo || null,
      onboarding: user.onboarding || null,
      favorites: Array.isArray(user.favorites) ? user.favorites : [],
    } : null,
    userListings,
    partner: partner ? {
      email: partner.email,
      name: partner.name,
      city: partner.city,
      stage: partner.stage,
      terms: partner.terms || '',
      objects: partner.objects || [],
      lastIn: partner.lastIn || '',
      lastOut: partner.lastOut || '',
      history: (partner.history || []).slice(-5),
    } : null,
    crm: crm ? {
      id: crm.id,
      name: crm.name,
      company: crm.company,
      role: crm.role,
      emails: crm.emails || [],
      phones: crm.phones || [],
      telegrams: crm.telegrams || [],
      inquiries: (crm.inquiries || []).slice(0, 8),
    } : null,
  };
}

/* ---------- Форматирование для ИИ и для Telegram-администраторов ---------- */

export function formatIdentityForAI(identity) {
  if (!identity) return '';
  const { matched, verified, extracted, user, userListings, partner, crm } = identity;
  const lines = [];

  if (!matched) {
    const found = [];
    if (extracted.emails.length) found.push('email: ' + extracted.emails.join(', '));
    if (extracted.phones.length) found.push('телефон: ' + extracted.phones.join(', '));
    if (extracted.telegrams.length) found.push('Telegram: ' + extracted.telegrams.join(', '));
    if (extracted.company) found.push('компания: ' + extracted.company);
    if (!found.length) return '';
    return `\n\nКОНТАКТЫ ИЗ СООБЩЕНИЯ\n${found.join(' · ')} (аккаунт в базе ещё не найден).`;
  }

  lines.push('УЗНАННЫЙ КЛИЕНТ / СОБСТВЕННИК / КОМПАНИЯ');
  if (user) {
    lines.push(
      `Аккаунт в кабинете: ${user.name}` +
      ` · роль: ${ROLE_LABEL[user.role] || user.role}` +
      (user.company ? ` · компания: ${user.company}` : '') +
      (verified ? ' (личность подтверждена)' : ' (НЕ авторизован в чате)')
    );
    if (verified) {
      const cts = [user.email, user.phone, user.telegram, user.contact].filter(Boolean);
      if (cts.length) lines.push(`Контакты аккаунта: ${[...new Set(cts)].join(', ')}`);
    } else {
      const masked = [user.email && maskEmail(user.email), user.phone && maskPhone(user.phone)].filter(Boolean);
      if (masked.length) {
        lines.push(`ВАЖНО ПО ПРИВАТНОСТИ: собеседник не авторизован токеном, поэтому НЕ раскрывай в ответе его скрытые контакты (${masked.join(', ')}). Для приватных деталей предложи войти в /cabinet/.`);
      }
    }
    if (user.onboarding) {
      const ob = user.onboarding;
      const s = [ob.goal, ob.country, ob.city, ob.type, ob.budget].filter(Boolean).join(' · ');
      if (s) lines.push(`Сохранённые предпочтения подбора: ${s}`);
    }
  }

  if (userListings && userListings.length) {
    lines.push(`Объекты этого собственника/компании в кабинете (${userListings.length}):`);
    for (const p of userListings.slice(0, 8)) {
      const pr = p.deal === 'rent'
        ? (p.rentMonthUSD ? `$${p.rentMonthUSD}/мес` : p.priceOriginal || '—')
        : (p.priceUSD ? `$${p.priceUSD}` : p.priceOriginal || '—');
      lines.push(
        `- [${p.id}] «${p.title}» (${p.deal === 'rent' ? 'аренда' : 'продажа'}, ${p.city || p.countryName || '—'}, ${pr}) — статус: ${STATUS_LABEL[p.status] || p.status}` +
        (p.rejectReason && p.status === 'rejected' ? ` (причина: ${p.rejectReason})` : '')
      );
    }
  }

  if (partner) {
    lines.push(
      `Партнёрская база (B2B): ${partner.name || partner.email}` +
      (partner.city ? `, ${partner.city}` : '') +
      ` · этап воронки: ${partner.stage}` +
      (partner.terms ? ` · условия: ${partner.terms}` : '')
    );
  }

  if (crm && crm.inquiries && crm.inquiries.length) {
    lines.push(`Предыдущие запросы и обращения (${crm.inquiries.length}):`);
    for (const q of crm.inquiries.slice(0, 5)) {
      lines.push(`- [${String(q.at || '').slice(0, 10)} · ${q.channel}] ${q.summary || q.listingTitle || q.region || 'Обращение'}`);
    }
  }

  return '\n\n' + lines.join('\n');
}

export function formatIdentityForAdmin(identity, esc) {
  if (!identity) return '';
  const { matched, extracted, user, userListings, partner, crm } = identity;
  const parts = [];

  if (user) {
    parts.push(
      `👤 <b>Кабинет:</b> ${esc(user.name)} (${esc(ROLE_LABEL[user.role] || user.role)})` +
      (user.company ? ` · <b>${esc(user.company)}</b>` : '')
    );
  } else if (crm && (crm.name || crm.company)) {
    parts.push(
      `📒 <b>В истории (CRM):</b> ${esc(crm.name || 'Клиент')}` +
      (crm.company ? ` · <b>${esc(crm.company)}</b>` : '')
    );
  }

  const emails = [...new Set([...(extracted.emails || []), ...((user && user.email) ? [user.email] : []), ...((crm && crm.emails) || [])])];
  const phones = [...new Set([...(extracted.phones || []), ...((user && user.phone) ? [normPhone(user.phone)] : []), ...((crm && crm.phones) || [])])].filter(Boolean);
  const tgs = [...new Set([...(extracted.telegrams || []), ...((user && user.telegram) ? [normTg(user.telegram)] : []), ...((crm && crm.telegrams) || [])])].filter(Boolean);

  if (emails.length) parts.push(`📧 ${esc(emails.slice(0, 3).join(', '))}`);
  if (phones.length) parts.push(`📞 ${esc(phones.slice(0, 3).map(p => '+' + p).join(', '))}`);
  if (tgs.length) parts.push(`✈️ ${esc(tgs.slice(0, 3).join(', '))}`);

  if (userListings && userListings.length) {
    const listStr = userListings.slice(0, 4).map(p =>
      `• ${esc(p.title)} (<i>${esc(STATUS_LABEL[p.status] || p.status)}</i>)`
    ).join('\n');
    parts.push(`🏠 <b>Объекты (${userListings.length}):</b>\n${listStr}`);
  }

  if (partner) {
    parts.push(
      `🤝 <b>Партнёр:</b> ${esc(partner.name || partner.email)} · этап: <b>${esc(partner.stage)}</b>` +
      (partner.terms ? `\nУсловия: ${esc(partner.terms.slice(0, 140))}` : '')
    );
  }

  if (crm && crm.inquiries && crm.inquiries.length) {
    const hist = crm.inquiries.slice(0, 3).map(q =>
      `• ${esc(String(q.at || '').slice(0, 10))} [${esc(q.channel)}]: ${esc(q.summary || q.listingTitle || 'Запрос')}`
    ).join('\n');
    parts.push(`🗂 <b>История обращений:</b>\n${hist}`);
  }

  if (!matched && !emails.length && !phones.length && !tgs.length) return '';
  return parts.join('\n');
}
