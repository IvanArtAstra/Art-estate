/* ============================================================
   Estate Art — первичный менеджер на Claude.

   Отвечает первым в чате на сайте и в боте, доводит разговор до
   контакта и передаёт живому агенту готовой карточкой. Дальше
   переписка идёт как обычно — через мост в Telegram.

   Ключ Anthropic живёт только в секретах воркера. Сайт статический
   и лежит в публичном репозитории: ключ в клиентском JS утёк бы за
   часы, и счёт пришёл бы владельцу. Поэтому виджет и бот ходят сюда,
   а сюда — к Anthropic.

   Если ключа нет или запрос упал, модуль молча отдаёт null, и воркер
   работает по-старому: сообщение уходит дежурному напрямую. Заявку
   нельзя терять из-за того, что сломался помощник.
   ============================================================ */

const MODEL = 'claude-haiku-5-5';   // если ответы станут плоскими: claude-sonnet-5-5
const MAX_TOKENS = 700;
const MAX_TOOL_ROUNDS = 3;
const HISTORY = 16;                  // сколько реплик держим в контексте

const SYSTEM = `Ты — первичный менеджер агентства Estate Art. Агентство продаёт
виллы и квартиры на Пхукете (Таиланд), в Дананге и Нячанге (Вьетнам).

ТВОЯ ЗАДАЧА
Понять, что человек ищет, и получить контакт, чтобы агент продолжил разговор.
Это короткий живой диалог, а не анкета. Не задавай больше одного вопроса за раз.

КАК ТЫ ГОВОРИШЬ
По-русски, на «вы», спокойно и по делу. Без восклицательных знаков, без «спешите»,
без смайликов, без слов «премиальный», «эксклюзивный», «уникальный». Короткие
абзацы. Так говорит человек, который продаёт недвижимость за сотни тысяч долларов
и не нуждается в том, чтобы это подчёркивать.

ПРО ЦЕНЫ — ВАЖНО
Никогда не называй цену конкретного объекта. Каталог — снимок на дату обновления,
объект мог уйти или подорожать, и названная цифра станет обещанием, которое некому
выполнить. Говори диапазонами по району: вызови инструмент price_range и назови
вилку. Точную цену подтверждает агент. Если инструмент не дал данных по району —
скажи прямо, что по нему мало объектов, и предложи соседний.

ПРО ПРАВО И НАЛОГИ
Отвечай своими словами, это помогает человеку решиться. Freehold — полная
собственность, для иностранца реальна в кондоминиуме в рамках иностранной квоты.
Виллы и дома чаще оформляют в долгосрочную аренду (leasehold), обычно 30 лет с
продлением. При покупке платят регистрационный сбор, гербовый сбор и услуги по
оформлению; точная сумма зависит от объекта. Во Вьетнаме у иностранцев срок
владения ограничен и есть квота на дом или комплекс.
Каждый раз, когда говоришь о праве или налогах, добавляй одной фразой, что это
общий ориентир, а не юридическая консультация, и что по конкретной сделке считает
юрист агентства. Если не уверен — так и скажи и передай вопрос агенту.

ЧЕГО НЕ ДЕЛАТЬ
Не обещать доходность, сроки сделки и одобрение рассрочки. Не выдумывать названия
комплексов, акции, скидки и наличие объектов. Не торговаться. Не говорить о людях
агентства ничего, кроме того, что с человеком свяжется агент.

КОГДА ЗАВЕРШАТЬ
Как только у тебя есть имя и способ связи — вызови save_lead и на этом передай
разговор. После вызова скажи одной-двумя фразами, что передал агенту и когда
ждать ответа. Не продолжай расспрашивать.
Если человек сразу просит связать с агентом — не удерживай, спроси контакт и
вызывай save_lead.`;

const TOOLS = [
  {
    name: 'price_range',
    description: 'Диапазон цен по городу, району или типу жилья из каталога агентства. ' +
      'Вызывай перед любым ответом о деньгах. Возвращает минимум, максимум, медиану, ' +
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
    name: 'save_lead',
    description: 'Передать заявку живому агенту. Вызывай, как только известны имя и контакт.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Как к человеку обращаться' },
        contact: { type: 'string', description: 'Телефон, Telegram или почта — как он дал' },
        looking_for: { type: 'string', description: 'Что ищет, своими словами: тип, спальни, море, под сдачу' },
        city: { type: 'string', description: 'Город или страна интереса, если назвал' },
        budget: { type: 'string', description: 'Бюджет, как прозвучал. Пусто, если не называл.' },
        timeline: { type: 'string', description: 'Когда планирует: смотрит, в этом году, готов сейчас' },
        notes: { type: 'string', description: 'Что ещё важно агенту: язык, часовой пояс, оговорки' },
      },
      required: ['name', 'contact', 'looking_for'],
    },
  },
];

/* Названия районов в каталоге пришли из двух источников и живут в двух
   алфавитах: «Чернг Талай» рядом с «An Hai Bac». Модель не обязана угадывать,
   каким написано нужное, поэтому сверяем нестрого: без регистра, пробелов и
   дефисов, плюс вхождение в обе стороны. */
const norm = v => String(v || '').toLowerCase().replace(/[\s\-_.]+/g, '');

// Возвращаем и каноническое написание: иначе в ответе клиенту окажется то,
// как название набрала модель, — «в чернгталай» вместо «в Чернг Талай»
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

  // Город тоже сверяем нестрого: «Да Нанг», «Дананг», «Da Nang» — одно и то же
  const cityKey = Object.keys(ranges.cities || {})
    .find(c => norm(c) === norm(city) || norm(c).includes(norm(city)) || norm(city).includes(norm(c)));
  if (!cityKey) {
    return {
      error: `Города «${city}» в каталоге нет`,
      available_cities: Object.keys(ranges.cities || {}),
    };
  }

  if (district) {
    const hit = findKey(ranges.districts, cityKey, district);
    if (hit) return shape(hit.b, `${hit.name}, ${cityKey}`, ranges);
    // Молча подменять район городом нельзя: модель решит, что отвечает про район
    const city_b = ranges.cities[cityKey];
    return shape(city_b, cityKey, ranges, {
      district_not_found: district,
      note_for_you: `По району «${district}» в каталоге нет выборки — цифры ниже по городу целиком. ` +
        `Скажите человеку об этом прямо и предложите соседний район из списка.`,
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

/* История диалога в формате Messages API. Берём хвост: длинная переписка
   первичному менеджеру не нужна, а каждый лишний ход стоит денег. */
function toMessages(session, userText) {
  const out = [];
  for (const m of (session.messages || []).slice(-HISTORY)) {
    if (!m.text) continue;
    out.push({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text });
  }
  if (userText) out.push({ role: 'user', content: userText });
  // Messages API требует, чтобы первым шёл user
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function callClaude(env, messages, system) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'user-agent': 'estate-art-chat/1.0 (cloudflare-worker)',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

/**
 * Ответ первичного менеджера.
 * @returns {Promise<null|{text:string, lead:object|null}>} null — помощник недоступен,
 *          воркер должен отправить сообщение дежурному напрямую.
 */
export async function aiReply(env, session, userText, ranges) {
  if (!env.ANTHROPIC_API_KEY) return null;

  /* Состав каталога кладём прямо в промпт: так модель с первого раза зовёт
     price_range с существующим районом, а не перебирает варианты по кругу —
     каждый лишний круг это деньги и секунда ожидания у человека. */
  let inventory = '';
  if (ranges && ranges.cities) {
    const lines = Object.keys(ranges.cities).map(c => {
      const ds = Object.keys(ranges.districts || {})
        .filter(k => k.split('|')[0] === c).map(k => k.split('|')[1]);
      const ts = Object.keys(ranges.types || {})
        .filter(k => k.split('|')[0] === c).map(k => k.split('|')[1]);
      return `${c}: ${ranges.cities[c].n} объектов` +
        (ds.length ? `; районы с выборкой — ${ds.join(', ')}` : '') +
        (ts.length ? `; типы — ${ts.join(', ')}` : '');
    });
    inventory = `\n\nЧТО ЕСТЬ В КАТАЛОГЕ (снимок на ${ranges.updated})\n` + lines.join('\n') +
      `\nРайонов вне этого списка в каталоге нет. Если спрашивают про такой — скажи, ` +
      `что по нему объектов сейчас нет, и назови ближайший из списка.`;
  }

  const system = SYSTEM + inventory +
    (session.page ? `\n\nСейчас человек на странице: ${session.page}` : '');

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
        } else if (c.name === 'save_lead') {
          lead = c.input || {};
          out = { ok: true, note: 'Заявка принята. Скажи, что передал агенту, и заверши разговор.' };
        } else {
          out = { error: 'Неизвестный инструмент' };
        }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    // Круги кончились, а модель всё зовёт инструменты — отдаём разговор человеку
    return { text: 'Передаю вас агенту — он ответит здесь же.', lead };
  } catch (e) {
    console.log('ai error:', e && e.message);
    return null;
  }
}

/** Карточка заявки дежурному. Читается с телефона за три секунды. */
export function leadCard(lead, sessionId, esc) {
  const row = (label, v) => (v ? `\n<b>${label}:</b> ${esc(String(v))}` : '');
  return `🟢 <b>Заявка с сайта</b>` +
    row('Имя', lead.name) +
    row('Контакт', lead.contact) +
    row('Ищет', lead.looking_for) +
    row('Город', lead.city) +
    row('Бюджет', lead.budget) +
    row('Сроки', lead.timeline) +
    row('Заметки', lead.notes) +
    `\n\n<code>#${sessionId}</code>` +
    `\n<i>Собрано первичным менеджером. Ответьте реплаем — ответ уйдёт на сайт.</i>`;
}
