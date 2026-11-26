/* ============================================================
   Estate Art — первичный менеджер и ИИ-консультант на Claude.
   ============================================================ */
import { resolveIdentity, formatIdentityForAI } from './identity.js';

const MODEL = 'claude-haiku-5-5';   // если ответы станут плоскими: claude-sonnet-5-5
const MAX_TOKENS = 800;
const MAX_TOOL_ROUNDS = 4;
const HISTORY = 16;                  // сколько реплик держим в контексте

const SYSTEM = `Ты — ИИ-консультант и первичный менеджер агентства Estate Art.
Агентство помогает покупать и арендовать виллы и квартиры на Пхукете (Таиланд),
в Дананге и Нячанге (Вьетнам), а также размещает проверенные объекты собственников
и застройщиков из личного кабинета в других регионах.

ТВОЯ ЗАДАЧА
1. Консультировать по объектам (как из общего каталога, так и добавленным
   собственниками/партнёрами в личном кабинете), районам, аренде и переезду.
2. Помогать подобрать вариант под задачу, регион и бюджет пользователя.
3. Если человек хочет просмотр, торг, проверку документов, точную актуальную
   цену или просит связаться с менеджером — собрать имя и способ связи
   (телефон, @telegram или email) и вызвать save_lead.
4. Если человек хочет разместить свой объект — кратко объяснить, что это
   делается в личном кабинете (/cabinet/#add) за пару минут, после чего команда
   быстро проверяет объявление и публикует его в каталоге и регионе.

КАК ТЫ ГОВОРИШЬ
По умолчанию по-русски, на «вы», спокойно и по делу. Если человек пишет на
другом языке (английский, тайский, вьетнамский и т.д.) — отвечай на его языке.
Без восклицательных знаков, без «спешите», без смайликов, без штампов
«премиальный», «эксклюзивный», «уникальный». Короткие абзацы. Не задавай
больше одного вопроса за раз.

ПРО ОБЪЕКТЫ И ЦЕНЫ — ВАЖНО
У тебя есть инструменты search_listings, get_listing_details и price_range.
- Когда спрашивают про конкретные варианты, районы или бюджет — вызывай
  search_listings (при обсуждении конкретного объекта — get_listing_details)
  и опирайся только на реальные поля из ответа инструмента.
- Для объектов из каталога (source != 'owner_cabinet') всегда уточняй, что цена
  в каталоге — ориентир на дату обновления снимка, а актуальную стоимость и
  наличие подтверждает менеджер перед сделкой.
- Для объектов из личного кабинета (ownerListing: true) называй параметры и цену,
  которые указал собственник/партнёр, и предлагай связать с менеджером для
  проверки документов и организации просмотра.
- Для общих вопросов по рынку района вызывай price_range. Никогда не выдумывай
  названия комплексов, цены, акции и характеристики, которых не вернули инструменты.

ПРО ПРАВО И НАЛОГИ
Freehold — полная собственность (в Таиланде доступна иностранцам в кондоминиуме
в рамках иностранной квоты до 49%). Виллы и дома чаще оформляют в долгосрочную
аренду (leasehold), обычно 30 лет с продлением. При покупке платят регистрационный
и гербовый сборы; точная сумма зависит от объекта. Во Вьетнаме у иностранцев срок
владения ограничен (обычно 50 лет с продлением) и действует квота на комплекс.
Каждый раз, когда говоришь о праве или налогах, добавляй одной фразой, что это
общий ориентир, а не юридическая консультация, и по конкретной сделке считает
юрист агентства. Если не уверен — так и скажи и предложи передать вопрос менеджеру.

ЧЕГО НЕ ДЕЛАТЬ
Не обещать точную доходность, сроки сделки и одобрение рассрочки. Не торговаться.
Не говорить о людях агентства лишнего — только что менеджер свяжется в этом чате
или по указанному контакту.

УЗНАВАНИЕ КЛИЕНТОВ, СОБСТВЕННИКОВ И КОМПАНИЙ
- Если человек указывает email, телефон, @telegram или название компании, или
  спрашивает о «моём объекте / статусе модерации / моей заявке / наших условиях» —
  вызови lookup_account_context (если этих данных ещё нет в КОНТЕКСТЕ СЕССИИ).
- Веди диалог предметно именно про его объекты (статусы публикации, цена, район,
  правка в /cabinet/#my-objects), сохранённый подбор или партнёрские условия.
- Если в контексте сказано «НЕ авторизован в чате», НЕ озвучивай скрытые телефон
  или email из найденного аккаунта — предложи войти в /cabinet/ для приватных
  деталей, а по общим вопросам и объектам консультируй свободно.

КОГДА ЗАВЕРШАТЬ И ПЕРЕДАВАТЬ МЕНЕДЖЕРУ
Как только человек просит связаться с менеджером, записаться на просмотр или дал
имя и способ связи под конкретный запрос — вызови save_lead. Если имя и контакт
уже известны из профиля пользователя в контексте, можно уточнить готовность к
связи или сразу вызвать save_lead по его просьбе. После вызова save_lead скажи
одной-двумя фразами, что передал запрос менеджеру и он скоро ответит здесь или
по контакту.`;

const TOOLS = [
  {
    name: 'search_listings',
    description: 'Поиск реальных объектов недвижимости в каталоге Estate Art и среди проверенных объектов собственников из личного кабинета.',
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Код страны (th, vn, tr, ae, id, ru...) или название: Таиланд, Вьетнам и т.д.' },
        city: { type: 'string', description: 'Город: Пхукет, Дананг, Нячанг и т.д.' },
        district: { type: 'string', description: 'Район: Банг Тао, Камала, Раваи, My Khe и т.д.' },
        type: { type: 'string', description: 'Тип: Вилла, Квартира, Кондо, Пентхаус, Апартаменты, Таунхаус' },
        deal: { type: 'string', description: 'sale (покупка) или rent (аренда)' },
        beds_min: { type: 'number', description: 'Минимум спален' },
        price_max_usd: { type: 'number', description: 'Максимальный бюджет в USD (для аренды — в месяц, для покупки — полная цена)' },
        query: { type: 'string', description: 'Свободный запрос по названию комплекса или особенностям' },
        owner_only: { type: 'boolean', description: 'Если true — искать только объекты от собственников/партнёров из кабинета' },
      },
    },
  },
  {
    name: 'get_listing_details',
    description: 'Получить полные характеристики конкретного объекта по его id или названию.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID объекта' },
        title: { type: 'string', description: 'Название объекта или комплекса' },
      },
    },
  },
  {
    name: 'price_range',
    description: 'Диапазон цен по городу, району или типу жилья из каталога агентства. ' +
      'Вызывай для общих вопросов о стоимости рынка. Возвращает минимум, максимум, медиану, ' +
      'цену за м² и число объектов в выборке.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Пхукет, Дананг или Нячанг' },
        district: { type: 'string', description: 'Район: Банг Тао, Камала, Сурин, Карон и т.п. Необязательно.' },
        type: { type: 'string', description: 'Вилла, Квартира, Пентхаус, Таунхаус. Необязательно.' },
      },
      required: ['city'],
    },
  },
  {
    name: 'lookup_account_context',
    description: 'Найти аккаунт клиента, собственника или компании по email, номеру телефона, @telegram или названию компании, чтобы увидеть их объекты, статусы модерации, партнёрские условия и прошлые запросы.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email клиента или компании' },
        phone: { type: 'string', description: 'Номер телефона в любом формате' },
        telegram: { type: 'string', description: '@username в Telegram' },
        company: { type: 'string', description: 'Название компании или агентства' },
      },
    },
  },
  {
    name: 'save_lead',
    description: 'Передать заявку и карточку клиента живому менеджеру в Telegram. Вызывай, как только известны имя и контакт (или по прямой просьбе связать с менеджером, если контакт уже есть).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Как к человеку обращаться' },
        contact: { type: 'string', description: 'Телефон, Telegram или почта' },
        looking_for: { type: 'string', description: 'Что ищет или по какому объекту вопрос' },
        city: { type: 'string', description: 'Город или страна интереса' },
        budget: { type: 'string', description: 'Бюджет, как прозвучал. Пусто, если не называл.' },
        timeline: { type: 'string', description: 'Сроки: смотрит, готов сейчас, в этом году' },
        listing_id: { type: 'string', description: 'ID обсуждаемого объекта, если есть' },
        listing_title: { type: 'string', description: 'Название обсуждаемого объекта, если есть' },
        user_region: { type: 'string', description: 'Откуда заходит пользователь, если известно' },
        role: { type: 'string', description: 'Покупатель, арендатор или собственник' },
        notes: { type: 'string', description: 'Важные детали для менеджера' },
      },
      required: ['name', 'contact', 'looking_for'],
    },
  },
];

const norm = v => String(v || '').toLowerCase().replace(/[\s\-_.]+/g, '');

function findKey(map, city, name) {
  if (!map || !name) return null;
  const want = norm(name);
  const inCity = Object.keys(map).filter(k => k.split('|')[0] === city);
  let k = inCity.find(x => norm(x.split('|')[1]) === want);
  if (!k) k = inCity.find(x => {
    const v = norm(x.split('|')[1]);
    return v.includes(want) || want.includes(v);
  });
  return k ? { b: map[k], name: k.split('|')[1] } : null;
}

function districtsOf(ranges, city) {
  return Object.keys(ranges.districts || {})
    .filter(k => k.split('|')[0] === city)
    .map(k => k.split('|')[1]);
}

function shape(b, scope, ranges, extra) {
  return Object.assign({
    scope, objects: b.n,
    min_usd: b.min, max_usd: b.max, median_usd: b.mid,
    median_price_per_sqm_usd: b.ppm || null,
    area_sqm: b.area_min ? `${b.area_min}–${b.area_max}` : null,
    snapshot_date: ranges.updated,
    caveat: ranges.note,
  }, extra || {});
}

function rangeText(ranges, { city, district, type }) {
  if (!ranges) return { error: 'Таблица цен недоступна' };

  const cityKey = Object.keys(ranges.cities || {})
    .find(c => norm(c) === norm(city) || norm(c).includes(norm(city)) || norm(city).includes(norm(c)));
  if (!cityKey) {
    return {
      error: `Города «${city}» в статистике диапазонов нет`,
      available_cities: Object.keys(ranges.cities || {}),
    };
  }

  if (district) {
    const hit = findKey(ranges.districts, cityKey, district);
    if (hit) return shape(hit.b, `${hit.name}, ${cityKey}`, ranges);
    const city_b = ranges.cities[cityKey];
    return shape(city_b, cityKey, ranges, {
      district_not_found: district,
      note_for_you: `По району «${district}» в таблице нет отдельной выборки — цифры ниже по городу целиком.`,
      available_districts: districtsOf(ranges, cityKey),
    });
  }

  if (type) {
    const hit = findKey(ranges.types, cityKey, type);
    if (hit) return shape(hit.b, `${hit.name}, ${cityKey}`, ranges,
      { available_districts: districtsOf(ranges, cityKey) });
  }

  return shape(ranges.cities[cityKey], cityKey, ranges,
    { available_districts: districtsOf(ranges, cityKey) });
}

function summarizeListing(it) {
  return {
    id: String(it.id || ''),
    title: it.title || '',
    deal: it.deal === 'rent' ? 'rent' : 'sale',
    country: it.country || '',
    countryName: it.countryName || '',
    city: it.city || '',
    location: it.location || '',
    type: it.type || '',
    beds: it.beds ?? null,
    baths: it.baths ?? null,
    area_sqm: it.area ?? null,
    price_usd: it.priceUSD ?? null,
    rent_month_usd: it.rentMonthUSD ?? null,
    price_label: it.priceOriginal || it.priceLabel || null,
    beach: it.beach || null,
    ownerListing: !!it.ownerListing,
    source: it.ownerListing ? 'owner_cabinet' : (it.deal === 'rent' ? 'rentals' : 'catalog'),
    url: it.url || null,
  };
}

function searchListingsTool(listings, input = {}) {
  if (!Array.isArray(listings) || !listings.length) {
    return { count: 0, items: [], note: 'Список объектов сейчас пуст.' };
  }
  const fCountry = norm(input.country);
  const fCity = norm(input.city);
  const fDistrict = norm(input.district);
  const fType = norm(input.type);
  const fDeal = norm(input.deal);
  const fQuery = norm(input.query);
  const bedsMin = Number(input.beds_min) || 0;
  const priceMax = Number(input.price_max_usd) || 0;
  const ownerOnly = !!input.owner_only;

  const matched = listings.filter(it => {
    if (ownerOnly && !it.ownerListing) return false;
    if (fCountry) {
      const c1 = norm(it.country);
      const c2 = norm(it.countryName);
      if (c1 !== fCountry && !c2.includes(fCountry) && !fCountry.includes(c2)) return false;
    }
    if (fCity) {
      const ct = norm(it.city);
      const loc = norm(it.location);
      if (!ct.includes(fCity) && !fCity.includes(ct) && !loc.includes(fCity)) return false;
    }
    if (fDistrict) {
      const loc = norm(it.location);
      const dist = norm(it.district);
      if (!loc.includes(fDistrict) && !dist.includes(fDistrict)) return false;
    }
    if (fType) {
      const tp = norm(it.type);
      if (!tp.includes(fType) && !fType.includes(tp)) return false;
    }
    if (fDeal) {
      const d = norm(it.deal || 'sale');
      if (d !== fDeal) return false;
    }
    if (bedsMin > 0) {
      const b = typeof it.beds === 'number' ? it.beds : 0;
      if (b < bedsMin) return false;
    }
    if (priceMax > 0) {
      const p = it.deal === 'rent' ? (it.rentMonthUSD || 0) : (it.priceUSD || 0);
      if (p > 0 && p > priceMax) return false;
    }
    if (fQuery) {
      const hay = norm([it.title, it.location, it.city, it.countryName, it.type, it.description, (it.features || []).join(' ')].join(' '));
      if (!hay.includes(fQuery)) return false;
    }
    return true;
  });

  // Объекты из личного кабинета показываем выше, чтобы консультант о них знал в первую очередь
  matched.sort((a, b) => (b.ownerListing ? 1 : 0) - (a.ownerListing ? 1 : 0));

  return {
    total_found: matched.length,
    items: matched.slice(0, 6).map(summarizeListing),
  };
}

function getListingDetailsTool(listings, input = {}) {
  if (!Array.isArray(listings) || !listings.length) return { error: 'Каталог недоступен' };
  const id = String(input.id || '').trim();
  const title = norm(input.title);

  let found = null;
  if (id) found = listings.find(it => String(it.id) === id);
  if (!found && title) {
    found = listings.find(it => norm(it.title) === title) ||
            listings.find(it => norm(it.title).includes(title) || title.includes(norm(it.title)));
  }
  if (!found) return { error: 'Объект с такими параметрами не найден' };

  return Object.assign(summarizeListing(found), {
    floor: found.floor ?? null,
    price_per_sqm_usd: found.pricePerM2 ?? null,
    description: found.description || '',
    features: found.features || [],
    included: found.included || [],
    extras: found.extras || [],
    availableFrom: found.availableFrom || null,
    ownerName: found.ownerName || null,
  });
}

function toMessages(session, userText) {
  const out = [];
  for (const m of (session.messages || []).slice(-HISTORY)) {
    if (!m.text) continue;
    out.push({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text });
  }
  if (userText) out.push({ role: 'user', content: userText });
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const RELAY_REGION = 'enam';

export async function callClaude(env, messages, system, opts = {}) {
  const payload = {
    model: opts.model || MODEL,
    max_tokens: opts.maxTokens || MAX_TOKENS,
    system,
    tools: opts.tools || TOOLS,
    messages,
  };
  if (opts.toolChoice) payload.tool_choice = opts.toolChoice;
  const body = JSON.stringify(payload);

  const id = env.AI_RELAY.idFromName('anthropic-' + RELAY_REGION);
  const stub = env.AI_RELAY.get(id, { locationHint: RELAY_REGION });
  const r = await stub.fetch('https://relay/', { method: 'POST', body });

  const colo = r.headers.get('x-relay-colo') || '?';
  if (!r.ok) {
    const text = (await r.text()).slice(0, 300);
    console.log('anthropic отказ', JSON.stringify({ status: r.status, relay_colo: colo, model: MODEL }));
    throw new Error('anthropic ' + r.status + ' ' + text);
  }
  console.log('anthropic ok, реле в', colo);
  return r.json();
}

function buildContextPrompt(session, ranges, listings, identity) {
  const parts = [];

  if (ranges && ranges.cities) {
    const lines = Object.keys(ranges.cities).map(c => {
      const ds = Object.keys(ranges.districts || {})
        .filter(k => k.split('|')[0] === c).map(k => k.split('|')[1]);
      const ts = Object.keys(ranges.types || {})
        .filter(k => k.split('|')[0] === c).map(k => k.split('|')[1]);
      return `${c}: ${ranges.cities[c].n} объектов` +
        (ds.length ? `; районы — ${ds.join(', ')}` : '') +
        (ts.length ? `; типы — ${ts.join(', ')}` : '');
    });
    parts.push(`КАТАЛОГ АГЕНТСТВА (снимок на ${ranges.updated})\n` + lines.join('\n'));
  }

  const ownerItems = (listings || []).filter(x => x.ownerListing);
  if (ownerItems.length) {
    const byRegion = {};
    for (const it of ownerItems) {
      const label = [it.city, it.countryName].filter(Boolean).join(', ') || 'Другой регион';
      byRegion[label] = (byRegion[label] || 0) + 1;
    }
    parts.push(
      `ОБЪЕКТЫ ИЗ ЛИЧНОГО КАБИНЕТА (одобрено: ${ownerItems.length})\n` +
      Object.entries(byRegion).map(([k, n]) => `${k}: ${n}`).join('; ') +
      `\nИспользуй search_listings чтобы находить их и консультировать клиентов.`
    );
  }

  if (session.page) parts.push(`Страница: ${session.page}`);

  if (session.geo && (session.geo.city || session.geo.countryName)) {
    parts.push(`Регион входа посетителя: ${[session.geo.city, session.geo.countryName].filter(Boolean).join(', ')}`);
  }
  if (session.profile && (session.profile.name || session.profile.role || session.profile.contact)) {
    parts.push(
      `Профиль пользователя: имя=${session.profile.name || session.name || 'Гость'}` +
      (session.profile.role ? `, роль=${session.profile.role}` : '') +
      (session.profile.contact ? `, контакт=${session.profile.contact}` : '')
    );
  } else if (session.name && session.name !== 'Гость') {
    parts.push(`Имя: ${session.name}${session.contact ? ', контакт: ' + session.contact : ''}`);
  }

  if (session.onboarding) {
    const ob = session.onboarding;
    const obTxt = [
      ob.goal && `цель=${ob.goal}`,
      ob.country && `регион=${ob.country}`,
      ob.city && `город=${ob.city}`,
      ob.type && `тип=${ob.type}`,
      ob.budget && `бюджет=${ob.budget}`,
    ].filter(Boolean).join(', ');
    if (obTxt) parts.push(`Предпочтения онбординга: ${obTxt}`);
  }

  if (session.contextListing && session.contextListing.title) {
    const cl = session.contextListing;
    parts.push(
      `Сейчас пользователь спрашивает про объект: id=${cl.id || ''}, «${cl.title}»` +
      (cl.city ? `, ${cl.city}` : '') +
      (cl.price ? `, ${cl.price}` : '') +
      (cl.ownerListing ? ' (из личного кабинета)' : '') +
      `. Вызови get_listing_details при необходимости подробностей.`
    );
  }

  const idBlock = formatIdentityForAI(identity);
  return (parts.length ? '\n\nКОНТЕКСТ СЕССИИ\n' + parts.join('\n') : '') + idBlock;
}

/**
 * Ответ первичного менеджера и ИИ-консультанта.
 * @returns {Promise<null|{text:string, lead:object|null}>}
 */
export async function aiReply(env, session, userText, ranges, listings = [], identity = null) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const system = SYSTEM + buildContextPrompt(session, ranges, listings, identity);
  const messages = toMessages(session, userText);
  if (!messages.length) return null;

  let lead = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await callClaude(env, messages, system);
      const text = (res.content || [])
        .filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      const calls = (res.content || []).filter(c => c.type === 'tool_use');

      if (!calls.length) return { text, lead };

      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const c of calls) {
        let out;
        if (c.name === 'price_range') {
          out = rangeText(ranges, c.input || {});
        } else if (c.name === 'search_listings') {
          out = searchListingsTool(listings, c.input || {});
        } else if (c.name === 'get_listing_details') {
          out = getListingDetailsTool(listings, c.input || {});
        } else if (c.name === 'lookup_account_context') {
          const found = await resolveIdentity(env, c.input || {}, { verified: !!session.verifiedAccount });
          if (found.user && !session.linkedUserId) session.linkedUserId = found.user.id;
          out = {
            matched: found.matched,
            verified: found.verified,
            role: found.user ? found.user.role : (found.crm && found.crm.role) || null,
            name: found.user ? found.user.name : (found.crm && found.crm.name) || null,
            company: (found.user && found.user.company) || (found.partner && found.partner.name) || (found.crm && found.crm.company) || null,
            userListings: found.userListings || [],
            partner: found.partner ? { name: found.partner.name, stage: found.partner.stage, terms: found.partner.terms } : null,
            recentInquiries: found.crm ? found.crm.inquiries.slice(0, 5) : [],
          };
        } else if (c.name === 'save_lead') {
          lead = c.input || {};
          out = { ok: true, note: 'Заявка принята и передана менеджеру. Скажи клиенту, что передал запрос и менеджер скоро ответит.' };
        } else {
          out = { error: 'Неизвестный инструмент' };
        }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: 'Передаю вас менеджеру — он уже видит переписку и скоро ответит здесь.', lead };
  } catch (e) {
    console.log('ai error:', e && e.message);
    return null;
  }
}

/** Карточка заявки дежурному менеджеру и администраторам. */
export function leadCard(lead, sessionId, esc, session = null, identity = null) {
  const row = (label, v) => (v ? `\n<b>${label}:</b> ${esc(String(v))}` : '');
  const geoStr = lead.user_region || (session && session.geo ? [session.geo.city, session.geo.countryName].filter(Boolean).join(', ') : '');
  const objStr = lead.listing_title || (session && session.contextListing && session.contextListing.title) || '';
  const obStr = session && session.onboarding
    ? [session.onboarding.goal, session.onboarding.country, session.onboarding.type, session.onboarding.budget].filter(Boolean).join(' · ')
    : '';
  const roleStr = lead.role || (session && session.profile && session.profile.role) || (identity && identity.user && identity.user.role) || '';
  const companyStr = (identity && identity.user && identity.user.company) || (identity && identity.partner && identity.partner.name) || (identity && identity.extracted && identity.extracted.company) || '';
  const extraContacts = [];
  if (identity && identity.extracted) {
    if (identity.extracted.emails.length) extraContacts.push(identity.extracted.emails[0]);
    if (identity.extracted.phones.length) extraContacts.push('+' + identity.extracted.phones[0]);
    if (identity.extracted.telegrams.length) extraContacts.push(identity.extracted.telegrams[0]);
  }
  const ownListCount = identity && identity.userListings ? identity.userListings.length : 0;

  return `🟢 <b>Заявка с сайта</b>` +
    row('Имя', lead.name) +
    row('Контакт', lead.contact) +
    row('Доп. контакты', extraContacts.join(' · ')) +
    row('Компания', companyStr) +
    row('Роль', roleStr) +
    row('Объекты в кабинете', ownListCount ? `${ownListCount} шт.` : '') +
    row('Ищет', lead.looking_for) +
    row('Объект', objStr) +
    row('Город', lead.city) +
    row('Бюджет', lead.budget) +
    row('Сроки', lead.timeline) +
    row('Онбординг', obStr) +
    row('Регион входа', geoStr) +
    row('Заметки', lead.notes) +
    `\n\n<code>#${sessionId}</code>` +
    `\n<i>Собрано ИИ-консультантом. Ответьте реплаем — ответ уйдёт в чат на сайте.</i>`;
}
