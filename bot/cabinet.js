/* ============================================================
   Estate Art — Личный кабинет, добавление объектов, регионализация,
   онбординг и уведомления администраторам в Telegram.
   ============================================================ */
import {
  extractContacts,
  indexUserContacts,
  recordInquiry,
  resolveIdentity,
  formatIdentityForAdmin,
  normEmail,
  normPhone,
  normTg,
} from './identity.js';

const TOKEN_TTL = 60 * 60 * 24 * 30;      // 30 дней
const MAX_PHOTO_BYTES = 1572864;          // 1.5 MiB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VALID_ROLES = new Set(['buyer', 'renter', 'owner', 'partner']);
const VALID_DEALS = new Set(['sale', 'rent']);

const COUNTRY_DICT = {
  th: { name: 'Таиланд', en: 'Thailand', currency: 'THB' },
  vn: { name: 'Вьетнам', en: 'Vietnam', currency: 'VND' },
  tr: { name: 'Турция', en: 'Turkey', currency: 'USD' },
  id: { name: 'Индонезия', en: 'Indonesia', currency: 'USD' },
  ae: { name: 'ОАЭ', en: 'UAE', currency: 'AED' },
  ge: { name: 'Грузия', en: 'Georgia', currency: 'USD' },
  ru: { name: 'Россия', en: 'Russia', currency: 'RUB' },
  kz: { name: 'Казахстан', en: 'Kazakhstan', currency: 'USD' },
  cy: { name: 'Кипр', en: 'Cyprus', currency: 'USD' },
  es: { name: 'Испания', en: 'Spain', currency: 'USD' },
  me: { name: 'Черногория', en: 'Montenegro', currency: 'USD' },
  us: { name: 'США', en: 'USA', currency: 'USD' },
  gb: { name: 'Великобритания', en: 'UK', currency: 'USD' },
  de: { name: 'Германия', en: 'Germany', currency: 'USD' },
  fr: { name: 'Франция', en: 'France', currency: 'USD' },
  cn: { name: 'Китай', en: 'China', currency: 'USD' },
  kr: { name: 'Южная Корея', en: 'South Korea', currency: 'USD' },
  jp: { name: 'Япония', en: 'Japan', currency: 'USD' },
  sg: { name: 'Сингапур', en: 'Singapore', currency: 'USD' },
  my: { name: 'Малайзия', en: 'Malaysia', currency: 'USD' },
  pt: { name: 'Португалия', en: 'Portugal', currency: 'USD' },
  gr: { name: 'Греция', en: 'Greece', currency: 'USD' },
};

const RATES_TO_USD = {
  USD: 1,
  EUR: 1.09,
  RUB: 1 / 92,
  THB: 1 / 36.5,
  VND: 1 / 26000,
  AED: 1 / 3.67,
};

const ROLE_LABEL = {
  buyer: 'Покупатель / Инвестор',
  renter: 'Арендатор',
  owner: 'Собственник',
  partner: 'Агент / Застройщик',
};

const STATUS_LABEL = {
  approved: 'Опубликован',
  pending: 'На проверке',
  rejected: 'Отклонён',
  draft: 'Черновик',
};

const CURR_SYM = {
  USD: '$',
  EUR: '€',
  RUB: '₽',
  THB: '฿',
  VND: '₫',
  AED: 'AED',
};

const clean = (v, max = 200) =>
  String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

function randHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function randId(prefix = '') {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return prefix + Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

function normLogin(raw) {
  const s = clean(raw, 120).toLowerCase();
  if (!s) return '';
  if (s.includes('@') && !s.startsWith('@')) return s; // email
  if (s.startsWith('@')) return '@' + s.slice(1).replace(/[^a-z0-9_]/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 7 && /^[\d+\s()-]+$/.test(s)) return 'tel:' + digits;
  return s;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return { hash: bytesToHex(bits), salt: bytesToHex(salt) };
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hitRate(env, request, scope, limit, ttlSec) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(Date.now() / (ttlSec * 1000));
  const key = `rl:${scope}:${ip}:${bucket}`;
  const n = parseInt((await env.CHAT.get(key)) || '0', 10) + 1;
  await env.CHAT.put(key, String(n), { expirationTtl: ttlSec * 2 });
  return n > limit;
}

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

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    contact: u.contact,
    email: u.email || '',
    phone: u.phone || '',
    telegram: u.telegram || '',
    company: u.company || '',
    role: u.role || 'buyer',
    geo: u.geo || null,
    onboarding: u.onboarding || null,
    favorites: Array.isArray(u.favorites) ? u.favorites : [],
    currency: u.currency || 'USD',
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+([a-f0-9]{24,128})$/i);
  return m ? m[1] : '';
}

export async function requireAuth(request, env) {
  const tok = bearerToken(request);
  if (!tok) return null;
  const rawTok = await env.CHAT.get('tok:' + tok);
  if (!rawTok) return null;
  let parsed;
  try { parsed = JSON.parse(rawTok); } catch { return null; }
  if (!parsed || !parsed.userId) return null;
  const rawUser = await env.CHAT.get('usr:' + parsed.userId);
  if (!rawUser) return null;
  try { return JSON.parse(rawUser); } catch { return null; }
}

let regionNamesRu = null;
try { regionNamesRu = new Intl.DisplayNames(['ru'], { type: 'region' }); } catch {}

function countryMeta(code, customName) {
  const c = clean(code, 8).toLowerCase();
  const known = COUNTRY_DICT[c];
  if (known) return { code: c, name: clean(customName, 60) || known.name, currency: known.currency };
  if (c) {
    let fallbackName = c.toUpperCase();
    if (regionNamesRu && /^[a-z]{2}$/.test(c)) {
      try { fallbackName = regionNamesRu.of(c.toUpperCase()) || fallbackName; } catch {}
    }
    return { code: c, name: clean(customName, 60) || fallbackName, currency: 'USD' };
  }
  // Если ввели только название страны, пробуем найти код
  const want = clean(customName, 60).toLowerCase();
  if (want) {
    for (const [k, v] of Object.entries(COUNTRY_DICT)) {
      if (v.name.toLowerCase() === want || v.en.toLowerCase() === want) {
        return { code: k, name: v.name, currency: v.currency };
      }
    }
    return { code: 'other', name: clean(customName, 60), currency: 'USD' };
  }
  return { code: 'th', name: 'Таиланд', currency: 'THB' };
}

function formatPriceOriginal(amount, currency) {
  const n = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sym = CURR_SYM[currency] || currency;
  if (currency === 'RUB' || currency === 'VND' || currency === 'AED') return `${n} ${sym}`;
  return `${sym}${n}`;
}

function sanitizeImageUrl(u) {
  const s = clean(u, 300);
  if (!s) return '';
  if (s.startsWith('/api/media/')) return s;
  if (/^https?:\/\/[^/\s]+\/api\/media\/[a-zA-Z0-9_-]+$/.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

function resolveMediaUrl(u, origin) {
  if (!u) return '';
  if (u.startsWith('/api/media/') && origin) return origin.replace(/\/+$/, '') + u;
  return u;
}

function sanitizeListingForPublic(p, origin = '') {
  const images = (Array.isArray(p.images) ? p.images : []).map(x => resolveMediaUrl(x, origin)).filter(Boolean);
  const image = resolveMediaUrl(p.image, origin) || images[0] || '';
  return {
    id: p.id,
    ownerListing: true,
    source: 'owner_cabinet',
    deal: p.deal || 'sale',
    title: p.title,
    country: p.country,
    countryName: p.countryName,
    city: p.city,
    district: p.district || '',
    location: p.location,
    type: p.type,
    beds: p.beds,
    baths: p.baths,
    area: p.area,
    floor: p.floor || null,
    beach: p.beach || null,
    priceUSD: p.priceUSD || null,
    priceLabel: p.priceLabel || null,
    priceOriginal: p.priceOriginal || null,
    currency: p.currency || 'USD',
    pricePerM2: p.pricePerM2 || null,
    rentMonthUSD: p.rentMonthUSD || null,
    rentMonthVND: p.rentMonthVND || null,
    description: p.description || '',
    features: Array.isArray(p.features) ? p.features : [],
    lat: p.lat || null,
    lng: p.lng || null,
    image,
    images,
    ownerName: p.ownerName || '',
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function propMetadata(p) {
  return {
    st: p.status || 'pending',
    c: String(p.country || '').slice(0, 8),
    ct: String(p.city || '').slice(0, 40),
    d: String(p.deal || 'sale').slice(0, 8),
    oid: String(p.ownerId || '').slice(0, 32),
    t: String(p.title || '').slice(0, 50),
    p: Number(p.priceUSD || p.rentMonthUSD || 0) || 0,
    ca: String(p.createdAt || '').slice(0, 24),
  };
}

/* ---------- Уведомления администраторам и собственникам в Telegram ---------- */

export async function notifyAdmins(env, deps, html, extra = {}) {
  if (!deps || !deps.tg || !env.BOT_TOKEN) return [];
  const rawIds = deps.chats ? deps.chats(env) : (deps.managers ? deps.managers(env) : []);
  const ids = [...new Set((rawIds || []).map(String).filter(Boolean))];
  const out = [];
  for (const chatId of ids) {
    try {
      const r = await deps.tg(env, 'sendMessage', Object.assign({
        chat_id: chatId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text: html,
      }, extra));
      out.push(r);
    } catch (e) {
      console.log('notifyAdmins err:', e && e.message);
    }
  }
  return out;
}

function moderationCardText(p, esc, isEdit = false) {
  const deal = p.deal === 'rent' ? 'Аренда' : 'Продажа';
  const priceStr = p.deal === 'rent'
    ? (p.rentMonthUSD ? `$${Math.round(p.rentMonthUSD).toLocaleString('en-US')}/мес (${p.priceOriginal || ''})` : (p.priceOriginal || 'по запросу'))
    : (p.priceUSD ? `$${Math.round(p.priceUSD).toLocaleString('en-US')}` + (p.currency && p.currency !== 'USD' && p.priceOriginal ? ` (${p.priceOriginal})` : '') : (p.priceOriginal || 'по запросу'));
  const specs = [
    p.type,
    p.beds != null && p.beds !== '' ? `${p.beds} сп.` : '',
    p.area ? `${p.area} м²` : '',
  ].filter(Boolean).join(' · ');
  const desc = p.description ? `\n<i>${esc(p.description.slice(0, 220))}${p.description.length > 220 ? '…' : ''}</i>` : '';
  return `${isEdit ? '✏️ <b>Объект обновлён (повторная проверка)</b>' : '🏠 <b>Новый объект из личного кабинета</b>'}\n` +
    `<b>${esc(p.title)}</b>\n` +
    `<b>Сделка:</b> ${deal} · ${esc(specs || '—')}\n` +
    `<b>Регион:</b> ${esc(p.countryName || '')}${p.location ? ' · ' + esc(p.location) : ''}\n` +
    `<b>Цена:</b> ${esc(priceStr)}\n` +
    `<b>От кого:</b> ${esc(p.ownerName || 'Пользователь')} (${esc(p.ownerContact || '—')})\n` +
    `<b>ID:</b> <code>${esc(p.id)}</code>` +
    desc;
}

function moderationKeyboard(propId) {
  return {
    inline_keyboard: [[
      { text: '✅ Опубликовать', callback_data: `cab:approve:${propId}` },
      { text: '❌ Отклонить', callback_data: `cab:reject:${propId}` },
    ]],
  };
}

export async function notifyAdminsListing(env, deps, prop, isEdit = false) {
  if (!deps || !deps.tg || !env.BOT_TOKEN) return;
  const esc = deps.esc || (s => String(s));
  const text = moderationCardText(prop, esc, isEdit);
  const reply_markup = moderationKeyboard(prop.id);
  const rawIds = deps.chats ? deps.chats(env) : (deps.managers ? deps.managers(env) : []);
  const ids = [...new Set((rawIds || []).map(String).filter(Boolean))];
  const canSendPhoto = prop.image && /^https:\/\//i.test(prop.image) && !/localhost|127\.0\.0\.1/i.test(prop.image);

  for (const chatId of ids) {
    try {
      if (canSendPhoto && text.length <= 1000) {
        const res = await deps.tg(env, 'sendPhoto', {
          chat_id: chatId,
          photo: prop.image,
          caption: text,
          parse_mode: 'HTML',
          reply_markup,
        });
        if (res && res.ok) continue;
      }
      await deps.tg(env, 'sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text,
        reply_markup,
      });
    } catch (e) {
      console.log('notifyAdminsListing err:', e && e.message);
    }
  }
}

/* ---------- Геолокация и публичный каталог объектов кабинета ---------- */

export async function getApprovedListings(env, origin = '') {
  const keys = await listAllKeys(env, 'prop:');
  const approvedKeys = keys.filter(k => !k.metadata || k.metadata.st === 'approved');
  const items = [];
  for (const k of approvedKeys) {
    const raw = await env.CHAT.get(k.name);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw);
      if (p && p.status === 'approved') items.push(sanitizeListingForPublic(p, origin));
    } catch {}
  }
  items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return items;
}

export async function handleGeo(request, env) {
  const cf = request.cf || {};
  const countryHeader = clean(request.headers.get('CF-IPCountry') || '', 4);
  const rawCode = clean(cf.country || countryHeader || '', 4).toLowerCase();
  const code = (rawCode && rawCode !== 'xx' && rawCode !== 't1') ? rawCode : '';
  const meta = code ? countryMeta(code) : null;
  const city = clean(cf.city || '', 80);
  const region = clean(cf.region || '', 80);
  const timezone = clean(cf.timezone || '', 60);

  const keys = await listAllKeys(env, 'prop:');
  const dynamicCountries = new Set(['th', 'vn']);
  for (const k of keys) {
    if (k.metadata && k.metadata.st === 'approved' && k.metadata.c) {
      dynamicCountries.add(k.metadata.c.toLowerCase());
    }
  }

  return json({
    ok: true,
    country: code,
    countryName: meta ? meta.name : '',
    city,
    region,
    timezone,
    suggestedCurrency: meta ? meta.currency : 'USD',
    hasLocalListings: !!(code && dynamicCountries.has(code)),
    availableCountries: Array.from(dynamicCountries),
  });
}

export async function handlePublicListings(request, env) {
  const url = new URL(request.url);
  const fCountry = clean(url.searchParams.get('country'), 8).toLowerCase();
  const fCity = clean(url.searchParams.get('city'), 60).toLowerCase();
  const fDeal = clean(url.searchParams.get('deal'), 10).toLowerCase();

  let items = await getApprovedListings(env, url.origin);
  if (fCountry) items = items.filter(it => String(it.country || '').toLowerCase() === fCountry);
  if (fCity) items = items.filter(it => String(it.city || '').toLowerCase() === fCity);
  if (fDeal) items = items.filter(it => String(it.deal || 'sale').toLowerCase() === fDeal);

  return json({ ok: true, count: items.length, items });
}

export async function handleMedia(request, env, photoId) {
  if (!/^[a-zA-Z0-9_-]{6,40}$/.test(photoId || '')) {
    return new Response('not found', { status: 404 });
  }
  const res = await env.CHAT.getWithMetadata('pimg:' + photoId, { type: 'arrayBuffer' });
  if (!res || !res.value) return new Response('not found', { status: 404 });
  const mime = (res.metadata && res.metadata.type) || 'image/jpeg';
  return new Response(res.value, {
    status: 200,
    headers: {
      'content-type': mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

/* ---------- Авторизация и профиль ---------- */

export async function handleRegister(request, env, deps) {
  if (await hitRate(env, request, 'auth', 20, 60)) {
    return json({ error: 'too_many_requests', message: 'Слишком много попыток. Подождите минуту.' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const name = clean(body.name, 80);
  const rawLogin = clean(body.login || body.contact || body.email, 120);
  const norm = normLogin(rawLogin);
  const password = String(body.password || '');
  const contact = clean(body.contact, 120) || rawLogin;
  const role = VALID_ROLES.has(body.role) ? body.role : 'buyer';

  if (!name || name.length < 2) {
    return json({ error: 'bad_name', message: 'Укажите ваше имя (минимум 2 символа).' }, 400);
  }
  if (!norm || norm.length < 3) {
    return json({ error: 'bad_login', message: 'Укажите email, телефон или @telegram.' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'weak_password', message: 'Пароль должен быть не короче 6 символов.' }, 400);
  }

  const exists = await env.CHAT.get('usr_login:' + norm);
  if (exists) {
    return json({
      error: 'already_exists',
      message: 'Аккаунт с этим контактом уже зарегистрирован. Попробуйте войти.',
    }, 409);
  }

  const userId = randId('u');
  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();

  const geo = body.geo && typeof body.geo === 'object' ? {
    country: clean(body.geo.country, 8).toLowerCase(),
    countryName: clean(body.geo.countryName, 60),
    city: clean(body.geo.city, 60),
  } : null;

  const onboarding = sanitizeOnboarding(body.onboarding);
  const favorites = Array.isArray(body.favorites)
    ? body.favorites.map(x => clean(x, 40)).filter(Boolean).slice(0, 200)
    : [];

  const ex = extractContacts(rawLogin + ' ' + contact, body);
  const email = normEmail(body.email) || ex.emails[0] || '';
  const phone = normPhone(body.phone) ? ('+' + normPhone(body.phone)) : (ex.phones[0] ? ('+' + ex.phones[0]) : '');
  const telegram = normTg(body.telegram) || ex.telegrams[0] || '';
  const company = clean(body.company, 120) || ex.company || '';

  const user = {
    id: userId,
    name,
    login: rawLogin,
    normLogin: norm,
    contact,
    email,
    phone,
    telegram,
    company,
    role,
    passwordHash: hash,
    passwordSalt: salt,
    geo,
    onboarding,
    favorites,
    currency: clean(body.currency, 6) || 'USD',
    createdAt: now,
    updatedAt: now,
  };

  await env.CHAT.put('usr:' + userId, JSON.stringify(user));
  await env.CHAT.put('usr_login:' + norm, userId);
  await indexUserContacts(env, user);

  if (onboarding || geo) {
    await recordInquiry(env, {
      userId,
      name,
      role,
      channel: 'cabinet_register',
      contacts: ex,
      summary: onboarding ? [onboarding.goal, onboarding.country, onboarding.type, onboarding.budget].filter(Boolean).join(' · ') : 'Регистрация в кабинете',
      region: geo && [geo.city, geo.countryName].filter(Boolean).join(', '),
      budget: onboarding && onboarding.budget,
    });
  }

  const token = randHex(32);
  await env.CHAT.put('tok:' + token, JSON.stringify({ userId, createdAt: now }), { expirationTtl: TOKEN_TTL });

  const esc = (deps && deps.esc) || (s => String(s));
  const geoLine = geo && (geo.city || geo.countryName)
    ? `\n<b>Регион входа:</b> ${esc([geo.city, geo.countryName].filter(Boolean).join(', '))}`
    : '';
  const obLine = onboarding && (onboarding.goal || onboarding.country || onboarding.budget)
    ? `\n<b>Интерес:</b> ${esc([onboarding.goal, onboarding.country, onboarding.type, onboarding.budget].filter(Boolean).join(' · '))}`
    : '';

  await notifyAdmins(env, deps,
    `🆕 <b>Новая регистрация в личном кабинете</b>\n` +
    `<b>Имя:</b> ${esc(name)}\n` +
    `<b>Роль:</b> ${esc(ROLE_LABEL[role] || role)}` +
    (company ? `\n<b>Компания:</b> ${esc(company)}` : '') +
    `\n<b>Контакт:</b> ${esc(contact)}` +
    geoLine + obLine
  );

  return json({ ok: true, token, user: publicUser(user) }, 201);
}

export async function handleLogin(request, env) {
  if (await hitRate(env, request, 'auth', 20, 60)) {
    return json({ error: 'too_many_requests', message: 'Слишком много попыток. Подождите минуту.' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const norm = normLogin(body.login || body.email || body.contact);
  const password = String(body.password || '');
  if (!norm || !password) {
    return json({ error: 'missing_credentials', message: 'Введите контакт и пароль.' }, 400);
  }

  const userId = await env.CHAT.get('usr_login:' + norm);
  if (!userId) {
    return json({ error: 'invalid_credentials', message: 'Неверный логин или пароль.' }, 401);
  }
  const rawUser = await env.CHAT.get('usr:' + userId);
  if (!rawUser) {
    return json({ error: 'invalid_credentials', message: 'Неверный логин или пароль.' }, 401);
  }
  const user = JSON.parse(rawUser);
  const { hash } = await hashPassword(password, user.passwordSalt);
  if (!safeEqualHex(hash, user.passwordHash)) {
    return json({ error: 'invalid_credentials', message: 'Неверный логин или пароль.' }, 401);
  }

  const token = randHex(32);
  await env.CHAT.put('tok:' + token, JSON.stringify({ userId: user.id, createdAt: new Date().toISOString() }), {
    expirationTtl: TOKEN_TTL,
  });

  return json({ ok: true, token, user: publicUser(user) });
}

export async function handleLogout(request, env) {
  const tok = bearerToken(request);
  if (tok) await env.CHAT.delete('tok:' + tok);
  return json({ ok: true });
}

function sanitizeOnboarding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    goal: clean(raw.goal, 40),
    country: clean(raw.country, 20),
    city: clean(raw.city, 60),
    type: clean(raw.type, 40),
    budget: clean(raw.budget, 40),
    updatedAt: clean(raw.updatedAt, 32) || new Date().toISOString(),
  };
  if (!out.goal && !out.country && !out.city && !out.type && !out.budget) return null;
  return out;
}

export async function handleMe(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized', message: 'Требуется авторизация.' }, 401);

  const keys = await listAllKeys(env, 'prop:');
  const stats = { total: 0, approved: 0, pending: 0, rejected: 0, draft: 0 };
  for (const k of keys) {
    if (k.metadata && k.metadata.oid === user.id) {
      stats.total++;
      const st = k.metadata.st || 'pending';
      if (stats[st] != null) stats[st]++;
    }
  }
  return json({ ok: true, user: publicUser(user), stats });
}

export async function handleUpdateProfile(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized', message: 'Требуется авторизация.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  if (body.name !== undefined) {
    const n = clean(body.name, 80);
    if (n.length >= 2) user.name = n;
  }
  if (body.contact !== undefined) {
    const c = clean(body.contact, 120);
    if (c) user.contact = c;
  }
  if (body.email !== undefined) user.email = normEmail(body.email) || '';
  if (body.phone !== undefined) {
    const d = normPhone(body.phone);
    user.phone = d ? '+' + d : '';
  }
  if (body.telegram !== undefined) user.telegram = normTg(body.telegram) || '';
  if (body.company !== undefined) user.company = clean(body.company, 120);
  if (body.role !== undefined && VALID_ROLES.has(body.role)) {
    user.role = body.role;
  }
  if (body.currency !== undefined && CURR_SYM[clean(body.currency, 6)]) {
    user.currency = clean(body.currency, 6);
  }
  if (body.favorites !== undefined && Array.isArray(body.favorites)) {
    user.favorites = body.favorites.map(x => clean(x, 40)).filter(Boolean).slice(0, 200);
  }
  if (body.onboarding !== undefined) {
    user.onboarding = sanitizeOnboarding(body.onboarding);
  }
  if (body.geo && typeof body.geo === 'object') {
    user.geo = {
      country: clean(body.geo.country, 8).toLowerCase(),
      countryName: clean(body.geo.countryName, 60),
      city: clean(body.geo.city, 60),
    };
  }
  user.updatedAt = new Date().toISOString();
  await env.CHAT.put('usr:' + user.id, JSON.stringify(user));
  await indexUserContacts(env, user);

  return json({ ok: true, user: publicUser(user) });
}

/* ---------- Объекты пользователя (CRUD + загрузка фото) ---------- */

function buildPropertyPayload(body, user, origin, existing = null) {
  const deal = VALID_DEALS.has(body.deal) ? body.deal : (existing ? existing.deal : 'sale');
  const title = clean(body.title, 120);
  const cm = countryMeta(body.country, body.countryName);
  const city = clean(body.city, 60);
  const district = clean(body.district, 60);
  const type = clean(body.type, 40) || 'Квартира';
  const currency = RATES_TO_USD[clean(body.currency, 6)] ? clean(body.currency, 6) : 'USD';
  const rawPrice = Number(body.price);

  if (!title || title.length < 3) return { error: 'Укажите название объекта или ЖК.' };
  if (!city) return { error: 'Укажите город.' };
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return { error: 'Укажите корректную цену.' };

  const rate = RATES_TO_USD[currency] || 1;
  const usdVal = Math.round(rawPrice * rate);
  const area = body.area !== undefined && body.area !== '' ? Number(body.area) : null;
  if (area !== null && (!Number.isFinite(area) || area <= 0 || area > 100000)) {
    return { error: 'Укажите корректную площадь (м²).' };
  }

  let beds = body.beds;
  if (beds === 'Студия' || beds === 'studio' || beds === 0 || beds === '0') beds = 'Студия';
  else if (beds !== undefined && beds !== null && beds !== '') {
    const nb = parseInt(beds, 10);
    beds = Number.isFinite(nb) && nb > 0 ? Math.min(nb, 30) : clean(beds, 20);
  } else beds = null;

  const baths = body.baths !== undefined && body.baths !== '' ? Math.min(Math.max(parseInt(body.baths, 10) || 0, 0), 30) : null;
  const floor = body.floor !== undefined && body.floor !== '' ? Math.min(Math.max(parseInt(body.floor, 10) || 0, 0), 200) : null;
  const beach = clean(body.beach, 80);
  const description = clean(body.description, 2500);

  const features = Array.isArray(body.features)
    ? body.features.map(f => clean(f, 40)).filter(Boolean).slice(0, 12)
    : [];

  let lat = body.lat !== undefined && body.lat !== '' ? Number(body.lat) : null;
  let lng = body.lng !== undefined && body.lng !== '' ? Number(body.lng) : null;
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) lat = null;
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) lng = null;

  const rawImages = Array.isArray(body.images) ? body.images : [];
  const images = rawImages.map(sanitizeImageUrl).filter(Boolean).slice(0, 10);
  const image = sanitizeImageUrl(body.image) || images[0] || '';

  const location = [district, city].filter(Boolean).join(', ');
  const priceOriginal = formatPriceOriginal(rawPrice, currency);
  const priceUSD = deal === 'sale' ? usdVal : null;
  const rentMonthUSD = deal === 'rent' ? usdVal : null;
  const rentMonthVND = deal === 'rent' && currency === 'VND' ? Math.round(rawPrice) : null;
  const pricePerM2 = (deal === 'sale' && area) ? Math.round(usdVal / area) : null;
  const priceLabel = deal === 'rent'
    ? (rentMonthUSD ? `$${rentMonthUSD.toLocaleString('en-US')}/мес` : priceOriginal)
    : (priceUSD ? `$${priceUSD.toLocaleString('en-US')}` : priceOriginal);

  const now = new Date().toISOString();
  const status = body.draft === true ? 'draft' : 'pending';

  const prop = {
    id: existing ? existing.id : randId('p_'),
    ownerId: user.id,
    ownerName: user.name,
    ownerContact: clean(body.ownerContact, 120) || user.contact || user.login,
    deal,
    title,
    country: cm.code,
    countryName: cm.name,
    city,
    district,
    location,
    type,
    beds,
    baths,
    area: area ? Math.round(area * 100) / 100 : null,
    floor,
    beach: beach || null,
    priceRaw: Math.round(rawPrice),
    currency,
    priceOriginal,
    priceUSD,
    priceLabel,
    pricePerM2,
    rentMonthUSD,
    rentMonthVND,
    description,
    features,
    lat,
    lng,
    image: resolveMediaUrl(image, origin),
    images: images.map(x => resolveMediaUrl(x, origin)),
    status,
    rejectReason: '',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    approvedAt: null,
    approvedBy: null,
  };
  return { prop };
}

export async function handleMyListings(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const origin = new URL(request.url).origin;
  const keys = await listAllKeys(env, 'prop:');
  const mine = keys.filter(k => !k.metadata || k.metadata.oid === user.id);
  const items = [];
  for (const k of mine) {
    const raw = await env.CHAT.get(k.name);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw);
      if (p && p.ownerId === user.id) {
        p.image = resolveMediaUrl(p.image, origin);
        p.images = (p.images || []).map(x => resolveMediaUrl(x, origin));
        items.push(p);
      }
    } catch {}
  }
  items.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return json({ ok: true, items });
}

export async function handleCreateListing(request, env, deps) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized', message: 'Войдите в кабинет.' }, 401);
  if (await hitRate(env, request, 'prop_write', 25, 3600)) {
    return json({ error: 'too_many_requests', message: 'Слишком много объявлений за час.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const origin = new URL(request.url).origin;
  const built = buildPropertyPayload(body, user, origin, null);
  if (built.error) return json({ error: 'validation_error', message: built.error }, 400);

  const { prop } = built;
  await env.CHAT.put('prop:' + prop.id, JSON.stringify(prop), { metadata: propMetadata(prop) });

  const ownerEx = extractContacts(prop.ownerContact || '', user);
  await indexUserContacts(env, Object.assign({}, user, {
    contact: [user.contact, prop.ownerContact].filter(Boolean).join(' '),
  }));
  await recordInquiry(env, {
    userId: user.id,
    name: user.name,
    role: user.role,
    contacts: ownerEx,
    channel: 'cabinet_listing',
    summary: `Добавил объект: ${prop.title} (${prop.city}, ${prop.priceLabel || ''})`,
    listingId: prop.id,
    listingTitle: prop.title,
    region: [prop.city, prop.countryName].filter(Boolean).join(', '),
  });

  if (prop.status === 'pending') {
    await notifyAdminsListing(env, deps, prop, false);
  }
  return json({ ok: true, item: prop }, 201);
}

export async function handleUpdateListing(request, env, deps, propId) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (await hitRate(env, request, 'prop_write', 25, 3600)) {
    return json({ error: 'too_many_requests', message: 'Лимит изменений исчерпан.' }, 429);
  }

  const raw = await env.CHAT.get('prop:' + propId);
  if (!raw) return json({ error: 'not_found', message: 'Объект не найден.' }, 404);
  const existing = JSON.parse(raw);
  if (existing.ownerId !== user.id) return json({ error: 'forbidden', message: 'Нет прав на этот объект.' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const origin = new URL(request.url).origin;
  const built = buildPropertyPayload(body, user, origin, existing);
  if (built.error) return json({ error: 'validation_error', message: built.error }, 400);

  const { prop } = built;
  await env.CHAT.put('prop:' + prop.id, JSON.stringify(prop), { metadata: propMetadata(prop) });

  if (prop.status === 'pending') {
    await notifyAdminsListing(env, deps, prop, true);
  }
  return json({ ok: true, item: prop });
}

export async function handleDeleteListing(request, env, propId) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const raw = await env.CHAT.get('prop:' + propId);
  if (!raw) return json({ error: 'not_found', message: 'Объект не найден.' }, 404);
  const existing = JSON.parse(raw);
  if (existing.ownerId !== user.id) return json({ error: 'forbidden', message: 'Нет прав на удаление.' }, 403);

  await env.CHAT.delete('prop:' + propId);
  return json({ ok: true });
}

export async function handlePhotoUpload(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'unauthorized', message: 'Войдите в кабинет для загрузки фото.' }, 401);
  if (await hitRate(env, request, 'photo', 60, 3600)) {
    return json({ error: 'too_many_requests', message: 'Слишком много загрузок фото. Попробуйте позже.' }, 429);
  }

  const ct = (request.headers.get('content-type') || '').toLowerCase();
  let bytes = null;
  let mime = '';

  if (ct.includes('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400); }
    const file = form.get('photo') || form.get('file');
    if (!file || typeof file === 'string') return json({ error: 'no_photo', message: 'Файл не найден.' }, 400);
    mime = String(file.type || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return json({ error: 'bad_mime', message: 'Разрешены только JPEG, PNG и WebP.' }, 400);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return json({ error: 'too_big', message: 'Фото тяжелее 1.5 МБ. Сожмите файл и повторите.' }, 413);
    }
    bytes = await file.arrayBuffer();
  } else {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const dataUrl = String(body.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) return json({ error: 'bad_image', message: 'Некорректный формат изображения.' }, 400);
    mime = m[1].toLowerCase();
    const bin = atob(m[2]);
    if (bin.length > MAX_PHOTO_BYTES) {
      return json({ error: 'too_big', message: 'Фото тяжелее 1.5 МБ.' }, 413);
    }
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    bytes = u8.buffer;
  }

  const photoId = randId('img_');
  await env.CHAT.put('pimg:' + photoId, bytes, {
    metadata: { type: mime, ownerId: user.id, createdAt: new Date().toISOString() },
  });

  const origin = new URL(request.url).origin;
  return json({ ok: true, id: photoId, url: `${origin}/api/media/${photoId}` }, 201);
}

/* ---------- Онбординг и лиды с сайта ---------- */

export async function handleOnboarding(request, env, deps) {
  if (await hitRate(env, request, 'onboard', 30, 60)) {
    return json({ error: 'too_many_requests' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const ob = sanitizeOnboarding(body);
  const name = clean(body.name, 80);
  const contact = clean(body.contact, 120);
  const geo = body.geo && typeof body.geo === 'object' ? {
    country: clean(body.geo.country, 8).toLowerCase(),
    countryName: clean(body.geo.countryName, 60),
    city: clean(body.geo.city, 60),
  } : null;

  const user = await requireAuth(request, env);
  if (user && ob) {
    user.onboarding = ob;
    if (geo) user.geo = geo;
    user.updatedAt = new Date().toISOString();
    await env.CHAT.put('usr:' + user.id, JSON.stringify(user));
  }

  if (contact || (user && user.contact)) {
    const esc = (deps && deps.esc) || (s => String(s));
    const whoName = name || (user && user.name) || 'Гость';
    const whoContact = contact || (user && user.contact);
    const identity = await resolveIdentity(env, {
      userId: user && user.id,
      contact: whoContact,
      name: whoName,
    }, { verified: true });
    await recordInquiry(env, {
      userId: user && user.id,
      name: whoName,
      contact: whoContact,
      channel: 'onboarding',
      summary: ob ? [ob.goal, ob.country, ob.type, ob.budget].filter(Boolean).join(' · ') : 'Онбординг на сайте',
      region: [ob && ob.country, ob && ob.city, geo && geo.city].filter(Boolean).join(', '),
      budget: ob && ob.budget,
    });
    const dossier = formatIdentityForAdmin(identity, esc);
    const geoTxt = geo && (geo.city || geo.countryName)
      ? `\n<b>Регион входа:</b> ${esc([geo.city, geo.countryName].filter(Boolean).join(', '))}` : '';
    await notifyAdmins(env, deps,
      `🎯 <b>Персональный онбординг на сайте</b>\n` +
      `<b>Имя:</b> ${esc(whoName)}\n` +
      `<b>Контакт:</b> ${esc(whoContact)}` +
      (ob && ob.goal ? `\n<b>Цель:</b> ${esc(ob.goal)}` : '') +
      (ob && (ob.country || ob.city) ? `\n<b>Локация:</b> ${esc([ob.country, ob.city].filter(Boolean).join(', '))}` : '') +
      (ob && ob.type ? `\n<b>Тип:</b> ${esc(ob.type)}` : '') +
      (ob && ob.budget ? `\n<b>Бюджет:</b> ${esc(ob.budget)}` : '') +
      geoTxt +
      (dossier ? `\n\n${dossier}` : '')
    );
  }

  return json({ ok: true, onboarding: ob });
}

export async function handleSiteLead(request, env, deps) {
  if (await hitRate(env, request, 'lead', 20, 60)) {
    return json({ error: 'too_many_requests' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const name = clean(body.name, 80) || 'Гость';
  const contact = clean(body.contact, 120);
  const message = clean(body.message, 1000);
  const source = clean(body.source, 40) || 'site_form';
  if (!contact) return json({ error: 'no_contact', message: 'Укажите контакт.' }, 400);

  const esc = (deps && deps.esc) || (s => String(s));
  const geo = body.geo && typeof body.geo === 'object' ? [body.geo.city, body.geo.countryName].filter(Boolean).join(', ') : '';
  const ob = body.onboarding && typeof body.onboarding === 'object'
    ? [body.onboarding.goal, body.onboarding.country, body.onboarding.type, body.onboarding.budget].filter(Boolean).join(' · ')
    : '';
  const listing = body.listing && typeof body.listing === 'object'
    ? [body.listing.title, body.listing.city, body.listing.price].filter(Boolean).join(' · ')
    : '';

  const identity = await resolveIdentity(env, {
    text: message,
    contact,
    name,
  }, { verified: true });

  await recordInquiry(env, {
    userId: identity.user && identity.user.id,
    name,
    contact,
    text: message,
    channel: source,
    summary: message || listing || ob || 'Заявка с сайта',
    listingId: body.listing && body.listing.id,
    listingTitle: body.listing && body.listing.title,
    region: geo,
  });

  const dossier = formatIdentityForAdmin(identity, esc);
  const sourceLabel = source === 'partner_contacts'
    ? '🔓 <b>Открыл контакты партнёров</b>'
    : '📩 <b>Новая заявка с сайта</b>';

  await notifyAdmins(env, deps,
    `${sourceLabel}\n` +
    `<b>Имя:</b> ${esc(name)}\n` +
    `<b>Контакт:</b> ${esc(contact)}` +
    (message ? `\n<b>Запрос:</b> ${esc(message)}` : '') +
    (listing ? `\n<b>Объект:</b> ${esc(listing)}` : '') +
    (ob ? `\n<b>Онбординг:</b> ${esc(ob)}` : '') +
    (geo ? `\n<b>Регион входа:</b> ${esc(geo)}` : '') +
    (dossier ? `\n\n${dossier}` : '')
  );

  return json({ ok: true });
}

/* ---------- Модерация и статистика в Telegram ---------- */

export async function handleCabinetCallback(cq, env, deps) {
  const data = String(cq.data || '');
  const m = data.match(/^cab:(approve|reject):([A-Za-z0-9_-]+)$/);
  if (!m) return false;

  const msg = cq.message;
  const chatId = msg && msg.chat && String(msg.chat.id);
  const fromId = cq.from && String(cq.from.id);
  const allowed = new Set(
    ((deps.chats ? deps.chats(env) : []) || [])
      .concat((deps.managers ? deps.managers(env) : []) || [])
      .map(String)
  );
  if (!allowed.has(chatId) && !allowed.has(fromId)) {
    if (deps.tg) await deps.tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Недостаточно прав' });
    return true;
  }

  const action = m[1];
  const propId = m[2];
  const raw = await env.CHAT.get('prop:' + propId);
  if (!raw) {
    if (deps.tg) await deps.tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Объект не найден' });
    return true;
  }

  const prop = JSON.parse(raw);
  const nextStatus = action === 'approve' ? 'approved' : 'rejected';
  prop.status = nextStatus;
  prop.updatedAt = new Date().toISOString();
  if (nextStatus === 'approved') {
    prop.approvedAt = prop.updatedAt;
    prop.approvedBy = fromId || chatId;
  } else {
    prop.rejectReason = 'Отклонено модератором';
  }
  await env.CHAT.put('prop:' + prop.id, JSON.stringify(prop), { metadata: propMetadata(prop) });

  const badge = nextStatus === 'approved' ? '\n\n✅ <b>Опубликован на сайте</b>' : '\n\n❌ <b>Отклонён</b>';
  const esc = deps.esc || (s => String(s));

  if (deps.tg) {
    await deps.tg(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: nextStatus === 'approved' ? 'Объект опубликован' : 'Объект отклонён',
    });

    if (msg) {
      const baseText = moderationCardText(prop, esc, false);
      const hasPhoto = !!(msg.photo && msg.photo.length);
      if (hasPhoto) {
        await deps.tg(env, 'editMessageCaption', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          parse_mode: 'HTML',
          caption: (baseText + badge).slice(0, 1024),
          reply_markup: { inline_keyboard: [] },
        });
      } else {
        await deps.tg(env, 'editMessageText', {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          text: baseText + badge,
          reply_markup: { inline_keyboard: [] },
        });
      }
    }
  }
  return true;
}

export async function cabinetStatsReport(env, deps) {
  const userKeys = await listAllKeys(env, 'usr:');
  const propKeys = await listAllKeys(env, 'prop:');
  const propCounts = { approved: 0, pending: 0, rejected: 0, draft: 0 };
  const byCountry = {};

  for (const k of propKeys) {
    const md = k.metadata || {};
    const st = md.st || 'pending';
    if (propCounts[st] != null) propCounts[st]++;
    if (st === 'approved' && md.c) {
      byCountry[md.c] = (byCountry[md.c] || 0) + 1;
    }
  }

  const esc = (deps && deps.esc) || (s => String(s));
  const regions = Object.entries(byCountry)
    .map(([c, n]) => `${esc((COUNTRY_DICT[c] && COUNTRY_DICT[c].name) || c.toUpperCase())}: ${n}`)
    .join(', ');

  return `📊 <b>Кабинет и объекты Estate Art</b>\n\n` +
    `<b>Пользователей:</b> ${userKeys.length}\n` +
    `<b>Объектов всего:</b> ${propKeys.length}\n` +
    `• Опубликовано: <b>${propCounts.approved}</b>\n` +
    `• На проверке: <b>${propCounts.pending}</b>\n` +
    `• Черновики: ${propCounts.draft} · Отклонено: ${propCounts.rejected}` +
    (regions ? `\n\n<b>По регионам:</b> ${regions}` : '') +
    (propCounts.pending ? `\n\n<i>Отправьте /pending, чтобы промодерировать очередь.</i>` : '');
}

export async function sendPendingListings(chatId, env, deps) {
  const keys = await listAllKeys(env, 'prop:');
  const pending = keys.filter(k => !k.metadata || k.metadata.st === 'pending').slice(0, 10);
  if (!pending.length) {
    await deps.tg(env, 'sendMessage', { chat_id: chatId, text: 'Очередь модерации пуста — новых объектов на проверке нет.' });
    return;
  }
  const esc = (deps && deps.esc) || (s => String(s));
  for (const k of pending) {
    const raw = await env.CHAT.get(k.name);
    if (!raw) continue;
    const p = JSON.parse(raw);
    if (p.status !== 'pending') continue;
    await deps.tg(env, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: moderationCardText(p, esc, false),
      reply_markup: moderationKeyboard(p.id),
    });
  }
}
