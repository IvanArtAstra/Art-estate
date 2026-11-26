import assert from 'node:assert/strict';
import worker from './worker.js';
import { extractContacts, resolveIdentity } from './identity.js';

function createMemoryKV() {
  const store = new Map();
  return {
    async get(key, opts) {
      const entry = store.get(key);
      if (!entry) return null;
      if (opts && opts.type === 'arrayBuffer') {
        if (entry.value instanceof ArrayBuffer) return entry.value;
        return new TextEncoder().encode(String(entry.value)).buffer;
      }
      return entry.value;
    },
    async getWithMetadata(key, opts) {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      return { value: await this.get(key, opts), metadata: entry.metadata || null };
    },
    async put(key, value, opts = {}) {
      store.set(key, { value, metadata: opts.metadata || null });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [];
      for (const [name, entry] of store.entries()) {
        if (name.startsWith(prefix)) keys.push({ name, metadata: entry.metadata || null });
      }
      return { keys: keys.slice(0, limit), list_complete: true, cursor: null };
    },
  };
}

const tgCalls = [];
const aiSystemPrompts = [];
let tgMsgSeq = 2000;
let aiStep = 0;

const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/bot')) {
    const method = u.split('/').pop();
    const payload = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const msgId = ++tgMsgSeq;
    tgCalls.push({ method, payload, msgId });
    return new Response(JSON.stringify({ ok: true, result: { message_id: msgId } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (u.endsWith('/data/price-ranges.json')) {
    return new Response(JSON.stringify({ updated: '2026-11-26', note: 'test', cities: {}, districts: {}, types: {} }), { status: 200 });
  }
  if (u.endsWith('/data/catalog.json') || u.endsWith('/data/rentals.json')) {
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }
  return origFetch(url, init);
};

const env = {
  CHAT: createMemoryKV(),
  BOT_TOKEN: '123:test-token',
  AGENT_CHAT_ID: '11111,22222',
  MAIL_CHAT_ID: '33333',
  CHANNEL_CHAT_ID: '-100999',
  ALLOWED_ORIGINS: 'http://localhost:8123',
  SITE_URL: 'https://estateart.homes/',
  WEBHOOK_SECRET: 'sec123',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_RELAY: {
    idFromName: n => n,
    get: () => ({
      async fetch(_url, init) {
        const body = JSON.parse(init.body);
        aiSystemPrompts.push({ system: body.system, tools: (body.tools || []).map(t => t.name) });

        // mail_digest
        if (body.tool_choice && body.tool_choice.name === 'mail_digest') {
          return new Response(JSON.stringify({
            content: [{
              type: 'tool_use',
              id: 'md1',
              name: 'mail_digest',
              input: {
                category: 'партнёр',
                summary: 'Пишет представитель компании Sun Villas по поводу своих объектов на Пхукете.',
                facts: ['Телефон +79124869508', 'Объект Villa Emerald'],
                company: 'Sun Villas',
                language: 'русский',
                urgency: 'обычная',
                actions: [{ label: 'Ответить по объекту', intent: 'Подтвердить статус Villa Emerald' }],
              },
            }],
          }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
        }

        // mail_draft
        if (body.tool_choice && body.tool_choice.name === 'mail_draft') {
          return new Response(JSON.stringify({
            content: [{
              type: 'tool_use',
              id: 'mdr1',
              name: 'mail_draft',
              input: {
                subject: 'Re: Статус объекта Villa Emerald',
                reply: 'Здравствуйте! Ваш объект Villa Emerald на Пхукете сейчас на проверке.',
                translation: 'Здравствуйте! Ваш объект Villa Emerald на Пхукете сейчас на проверке.',
              },
            }],
          }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
        }

        // Chat / DM AI with lookup_account_context test on first unauth call
        aiStep++;
        const lastMsg = body.messages[body.messages.length - 1];
        const hasToolRes = Array.isArray(lastMsg.content) && lastMsg.content.some(c => c.type === 'tool_result');
        if (!hasToolRes && aiStep === 1) {
          return new Response(JSON.stringify({
            content: [
              { type: 'tool_use', id: 'l1', name: 'lookup_account_context', input: { phone: '89124869508' } },
            ],
          }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
        }
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: 'Вижу вашу виллу Villa Emerald в Пхукете — она сейчас на проверке, скоро опубликуем.' }],
        }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
      },
    }),
  },
};

function req(path, opts = {}) {
  return new Request('https://worker.test' + path, Object.assign({}, opts, {
    headers: Object.assign({ Origin: 'http://localhost:8123' }, opts.headers || {}),
  }));
}

async function run() {
  // 1. Contact extraction accuracy & false-positive resistance
  const ex = extractContacts(
    'Пишу от компании «Sun Villas» (дата 2026-11-26, бюджет 13 000 000). Мой номер 8 (912) 486-95-08, запасной +66 81 234 5678, почта Owner@SunVillas.com и телеграм t.me/Sun_Villas_Boss'
  );
  assert.deepEqual(ex.emails, ['owner@sunvillas.com']);
  assert.ok(ex.phoneLast10.includes('9124869508'));
  assert.ok(ex.phoneLast10.includes('66812345678'.slice(-10)));
  assert.ok(ex.telegrams.includes('@sun_villas_boss'));
  assert.equal(ex.company, 'Sun Villas');

  const noFalse = extractContacts('Дата 2026-11-26, цена 8 000 000 рублей за 120 м2');
  assert.equal(noFalse.phones.length, 0, 'Dates and round prices must not be detected as phones');

  // 2. Register owner + update profile with phone, tg, company + create listing
  const regRes = await worker.fetch(req('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Мария Солнцева',
      login: 'owner@sunvillas.com',
      company: 'Sun Villas',
      password: 'password123',
      role: 'owner',
    }),
  }), env);
  assert.equal(regRes.status, 201);
  const { token, user } = await regRes.json();

  const profRes = await worker.fetch(req('/api/cabinet/profile', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      phone: '+7 (912) 486-95-08',
      telegram: '@sun_villas_boss',
      company: 'Sun Villas',
    }),
  }), env);
  assert.equal(profRes.status, 200);

  const propRes = await worker.fetch(req('/api/cabinet/listings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      deal: 'sale',
      title: 'Villa Emerald',
      country: 'th',
      countryName: 'Таиланд',
      city: 'Пхукет',
      type: 'Вилла',
      price: 550000,
      currency: 'USD',
    }),
  }), env);
  assert.equal(propRes.status, 201);

  // Verify resolveIdentity finds user via phone in 8... format, @tg, and company
  const byPhone = await resolveIdentity(env, { text: 'мой телефон 89124869508' }, { verified: true });
  assert.equal(byPhone.user.id, user.id);
  assert.equal(byPhone.userListings.length, 1);
  assert.equal(byPhone.userListings[0].title, 'Villa Emerald');

  const byCompany = await resolveIdentity(env, { company: 'ООО Sun Villas' }, { verified: false });
  assert.equal(byCompany.user.id, user.id);

  // 3. Site chat WITHOUT auth token -> privacy masked, lookup_account_context works
  const unauthChat = await worker.fetch(req('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'sess_unauth',
      text: 'Здравствуйте, звоню с 89124869508, подскажите по статусу моего объекта',
    }),
  }), env);
  assert.equal(unauthChat.status, 200);
  const unauthData = await unauthChat.json();
  assert.ok(unauthData.reply.includes('Villa Emerald'));
  const unauthPrompt = aiSystemPrompts[0].system;
  assert.ok(unauthPrompt.includes('НЕ авторизован в чате'), 'Unauth chat must enforce privacy guard');
  assert.ok(unauthPrompt.includes('Villa Emerald'), 'AI must see owner listings');

  // 4. Site chat WITH auth Bearer token -> verifiedAccount = true
  const authChat = await worker.fetch(req('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      sessionId: 'sess_auth',
      text: 'Привет! Что с моей виллой?',
    }),
  }), env);
  assert.equal(authChat.status, 200);
  const authPrompt = aiSystemPrompts[aiSystemPrompts.length - 1].system;
  assert.ok(authPrompt.includes('личность подтверждена'));
  assert.ok(authPrompt.includes('Villa Emerald'));

  // 5. Telegram DM: message.contact links chatId -> /my -> contextual DM AI
  const contactHook = await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({
      message: {
        chat: { id: 998877, type: 'private' },
        from: { id: 998877, username: 'sun_villas_boss', first_name: 'Мария' },
        contact: { phone_number: '79124869508', first_name: 'Мария' },
      },
    }),
  }), env);
  assert.equal(contactHook.status, 200);
  assert.ok(tgCalls.some(c => String(c.payload.chat_id) === '998877' && String(c.payload.text).includes('Узнал ваш аккаунт') && String(c.payload.text).includes('Villa Emerald')));

  await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({
      message: { chat: { id: 998877, type: 'private' }, from: { id: 998877 }, text: '/my' },
    }),
  }), env);
  assert.ok(tgCalls.some(c => String(c.payload.chat_id) === '998877' && String(c.payload.text).includes('Ваш профиль в Estate Art') && String(c.payload.text).includes('Sun Villas')));

  // 6. Domain email -> recognizes owner/company + enriches Telegram card + draftReply context
  const rawEmail =
    'From: Maria <owner@sunvillas.com>\r\n' +
    'To: partners@estateart.homes\r\n' +
    'Subject: Villa Emerald status\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n\r\n' +
    'Добрый день! Подскажите по Villa Emerald. Компания Sun Villas, тел +7 912 486-95-08.';
  const tgBeforeMail = tgCalls.length;
  await worker.email({
    from: 'owner@sunvillas.com',
    to: 'partners@estateart.homes',
    raw: new TextEncoder().encode(rawEmail),
    async forward() {},
  }, env);
  const mailCards = tgCalls.slice(tgBeforeMail).filter(c => c.method === 'sendMessage');
  assert.ok(mailCards.some(c => String(c.payload.text).includes('Villa Emerald') && String(c.payload.text).includes('Sun Villas')), 'Email card must display recognized owner account and listings');

  // Trigger draft button ml:d:<id>
  const cardMsg = mailCards.find(c => c.payload && c.payload.reply_markup);
  const draftBtn = JSON.stringify(cardMsg.payload.reply_markup).match(/ml:d:([a-z0-9]+)/);
  assert.ok(draftBtn, 'Email card must include draft callback button');
  const promptsBeforeDraft = aiSystemPrompts.length;
  await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({
      callback_query: {
        id: 'cq_mail_d',
        from: { id: 11111 },
        message: { chat: { id: 11111 }, message_id: cardMsg.msgId },
        data: `ml:d:${draftBtn[1]}`,
      },
    }),
  }), env);
  const draftSys = aiSystemPrompts[promptsBeforeDraft].system;
  assert.ok(draftSys.includes('Villa Emerald'), 'Email draft generator must receive sender properties & dossier');

  // 7. Admin /client <query> command
  const tgBeforeClient = tgCalls.length;
  await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({
      message: { chat: { id: 11111 }, text: '/client +7 912 486 95 08' },
    }),
  }), env);
  assert.ok(tgCalls.slice(tgBeforeClient).some(c => String(c.payload.text).includes('Мария Солнцева') && String(c.payload.text).includes('Villa Emerald')));

  console.log('ALL IDENTITY TESTS PASSED! Telegram API calls:', tgCalls.length);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
