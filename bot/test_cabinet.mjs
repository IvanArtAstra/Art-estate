import assert from 'node:assert/strict';
import worker from './worker.js';

function createMemoryKV() {
  const store = new Map();
  return {
    async get(key, opts) {
      const entry = store.get(key);
      if (!entry) return null;
      if (opts && opts.type === 'arrayBuffer') {
        if (entry.value instanceof ArrayBuffer) return entry.value;
        if (ArrayBuffer.isView(entry.value)) return entry.value.buffer;
        return new TextEncoder().encode(String(entry.value)).buffer;
      }
      return entry.value;
    },
    async getWithMetadata(key, opts) {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      const val = await this.get(key, opts);
      return { value: val, metadata: entry.metadata || null };
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
        if (name.startsWith(prefix)) {
          keys.push({ name, metadata: entry.metadata || null });
        }
      }
      return { keys: keys.slice(0, limit), list_complete: true, cursor: null };
    },
  };
}

const tgCalls = [];
let tgMsgSeq = 1000;
let aiRound = 0;

const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/bot')) {
    const method = u.split('/').pop();
    let payload = {};
    if (typeof init.body === 'string') {
      payload = JSON.parse(init.body);
    } else if (init.body && typeof init.body.get === 'function') {
      payload = { chat_id: init.body.get('chat_id'), caption: init.body.get('caption') };
    }
    const msgId = ++tgMsgSeq;
    tgCalls.push({ method, payload, msgId });
    return new Response(JSON.stringify({ ok: true, result: { message_id: msgId } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (u.endsWith('/data/price-ranges.json')) {
    return new Response(JSON.stringify({
      updated: '2026-11-26',
      note: 'Test snapshot',
      cities: { 'Пхукет': { n: 10, min: 80000, max: 1500000, mid: 250000, ppm: 2500, area_min: 35, area_max: 500 } },
      districts: { 'Пхукет|Банг Тао': { n: 4, min: 150000, max: 900000, mid: 350000, ppm: 3000, area_min: 45, area_max: 350 } },
      types: {},
    }), { status: 200 });
  }
  if (u.endsWith('/data/catalog.json')) {
    return new Response(JSON.stringify({
      items: [
        { id: 'cat1', title: 'Laguna Demo Condo', country: 'th', countryName: 'Таиланд', city: 'Пхукет', location: 'Банг Тао, Пхукет', type: 'Кондо', beds: 2, area: 75, priceUSD: 210000 },
      ],
    }), { status: 200 });
  }
  if (u.endsWith('/data/rentals.json')) {
    return new Response(JSON.stringify({
      items: [
        { id: 'r1', title: 'Golden Bay Studio', country: 'vn', countryName: 'Вьетнам', city: 'Дананг', location: 'Golden Bay, Дананг', type: 'Апартаменты', area: 37, rentMonthUSD: 500 },
      ],
    }), { status: 200 });
  }
  return origFetch(url, init);
};

const env = {
  CHAT: createMemoryKV(),
  BOT_TOKEN: '123:test-token',
  AGENT_CHAT_ID: '11111,22222',
  MAIL_CHAT_ID: '33333',
  CHANNEL_CHAT_ID: '-100999',
  ALLOWED_ORIGINS: 'https://estateart.homes,http://localhost:8123',
  SITE_URL: 'https://estateart.homes/',
  WEBHOOK_SECRET: 'sec123',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_RELAY: {
    idFromName: (n) => n,
    get: () => ({
      async fetch(_url, init) {
        const reqBody = JSON.parse(init.body);
        aiRound++;
        const lastMsg = reqBody.messages[reqBody.messages.length - 1];
        const hasToolResult = Array.isArray(lastMsg.content) && lastMsg.content.some(c => c.type === 'tool_result');

        if (!hasToolResult && aiRound === 1) {
          return new Response(JSON.stringify({
            content: [
              { type: 'tool_use', id: 'tu1', name: 'search_listings', input: { city: 'Анталья', owner_only: true } },
            ],
          }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
        }
        if (hasToolResult && aiRound === 2) {
          const toolOut = JSON.parse(lastMsg.content[0].content);
          assert.equal(toolOut.total_found, 1, 'AI search_listings must find approved owner listing');
          const foundId = toolOut.items[0].id;
          return new Response(JSON.stringify({
            content: [
              { type: 'tool_use', id: 'tu2', name: 'get_listing_details', input: { id: foundId } },
              {
                type: 'tool_use',
                id: 'tu3',
                name: 'save_lead',
                input: {
                  name: 'Иван',
                  contact: '@ivan_test',
                  looking_for: 'Вилла у моря в Анталье',
                  city: 'Анталья',
                  listing_id: foundId,
                  listing_title: 'Вилла Turquoise Bay',
                  user_region: 'Стамбул, Турция',
                },
              },
            ],
          }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
        }
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: 'Нашёл виллу Turquoise Bay в Анталье от собственника и передал ваш запрос менеджеру.' }],
        }), { status: 200, headers: { 'x-relay-colo': 'IAD' } });
      },
    }),
  },
};

function req(path, opts = {}) {
  const headers = Object.assign({ Origin: 'http://localhost:8123' }, opts.headers || {});
  if (opts.cf) {
    // attach cf below
  }
  const r = new Request('https://worker.test' + path, Object.assign({}, opts, { headers }));
  if (opts.cf) Object.defineProperty(r, 'cf', { value: opts.cf });
  return r;
}

async function run() {
  // 1. Geo endpoint (TH, VN, RU, AE)
  for (const [country, expectedCurr] of [['TH', 'THB'], ['VN', 'VND'], ['RU', 'RUB'], ['AE', 'AED']]) {
    const r = await worker.fetch(req('/api/geo', { cf: { country, city: 'TestCity' } }), env);
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.country, country.toLowerCase());
    assert.equal(d.suggestedCurrency, expectedCurr);
  }

  // 2. Register user 1 + duplicate + login + me + logout
  const regRes = await worker.fetch(req('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ольга Собственник',
      login: 'olga@example.com',
      password: 'secret123',
      role: 'owner',
      geo: { country: 'tr', countryName: 'Турция', city: 'Анталья' },
    }),
  }), env);
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  assert.ok(regData.token);
  assert.equal(regData.user.role, 'owner');
  assert.equal(regData.user.passwordHash, undefined);
  assert.ok(tgCalls.some(c => c.method === 'sendMessage' && String(c.payload.text).includes('Новая регистрация')), 'Admins must be notified of registration');

  // Duplicate
  const dupRes = await worker.fetch(req('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ольга', login: 'OLGA@example.com', password: 'secret123' }),
  }), env);
  assert.equal(dupRes.status, 409);

  // Wrong password
  const badLogin = await worker.fetch(req('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'olga@example.com', password: 'wrong' }),
  }), env);
  assert.equal(badLogin.status, 401);

  // Good login
  const okLogin = await worker.fetch(req('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'olga@example.com', password: 'secret123' }),
  }), env);
  assert.equal(okLogin.status, 200);
  const loginData = await okLogin.json();
  const token1 = loginData.token;

  // Me
  const meRes = await worker.fetch(req('/api/cabinet/me', {
    headers: { Authorization: 'Bearer ' + token1 },
  }), env);
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.login, 'olga@example.com');
  assert.equal(meData.user.passwordHash, undefined);

  // Logout original token
  const outRes = await worker.fetch(req('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + regData.token },
  }), env);
  assert.equal(outRes.status, 200);
  const meAfterLogout = await worker.fetch(req('/api/cabinet/me', {
    headers: { Authorization: 'Bearer ' + regData.token },
  }), env);
  assert.equal(meAfterLogout.status, 401);

  // 3. Profile update + onboarding
  const profRes = await worker.fetch(req('/api/cabinet/profile', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token1, 'content-type': 'application/json' },
    body: JSON.stringify({
      favorites: ['cat1', 'cat2'],
      onboarding: { goal: 'invest', country: 'tr', type: 'Вилла', budget: '500000' },
    }),
  }), env);
  assert.equal(profRes.status, 200);
  const profData = await profRes.json();
  assert.deepEqual(profData.user.favorites, ['cat1', 'cat2']);

  const obCountBefore = tgCalls.length;
  const obRes = await worker.fetch(req('/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'live', country: 'th', type: 'Вилла', budget: '250000', name: 'Гость', contact: '+79990001122' }),
  }), env);
  assert.equal(obRes.status, 200);
  assert.ok(tgCalls.length > obCountBefore, 'Onboarding with contact must notify admins');

  // 4. Photo upload & media retrieval
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  const upRes = await worker.fetch(req('/api/cabinet/photos', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token1, 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl: png1x1 }),
  }), env);
  assert.equal(upRes.status, 201);
  const upData = await upRes.json();
  assert.ok(upData.url.includes('/api/media/'));

  const mediaRes = await worker.fetch(req('/api/media/' + upData.id), env);
  assert.equal(mediaRes.status, 200);
  assert.equal(mediaRes.headers.get('content-type'), 'image/png');
  const buf = await mediaRes.arrayBuffer();
  assert.ok(buf.byteLength > 20);

  // 5. Create listing -> pending -> NOT in public listings yet
  const tgBeforeProp = tgCalls.length;
  const createRes = await worker.fetch(req('/api/cabinet/listings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token1, 'content-type': 'application/json' },
    body: JSON.stringify({
      deal: 'sale',
      title: 'Вилла Turquoise Bay',
      country: 'tr',
      countryName: 'Турция',
      city: 'Анталья',
      district: 'Лара',
      type: 'Вилла',
      beds: 4,
      baths: 3,
      area: 260,
      price: 380000,
      currency: 'USD',
      description: 'Просторная вилла с бассейном.',
      images: [upData.url],
      image: upData.url,
    }),
  }), env);
  assert.equal(createRes.status, 201);
  const createdProp = (await createRes.json()).item;
  assert.equal(createdProp.status, 'pending');
  assert.ok(tgCalls.slice(tgBeforeProp).some(c => c.payload && c.payload.reply_markup && JSON.stringify(c.payload.reply_markup).includes(`cab:approve:${createdProp.id}`)), 'Moderation card must have approve button');

  const pubBeforeApprove = await (await worker.fetch(req('/api/listings'), env)).json();
  assert.equal(pubBeforeApprove.count, 0, 'Pending listing must not appear in public /api/listings');

  // 6. Telegram callback cab:approve:<id> -> appears in public /api/listings
  const approveHook = await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({
      callback_query: {
        id: 'cq_1',
        from: { id: 11111 },
        message: { chat: { id: 11111 }, message_id: 555, text: 'moderation' },
        data: `cab:approve:${createdProp.id}`,
      },
    }),
  }), env);
  assert.equal(approveHook.status, 200);

  const pubAfterApprove = await (await worker.fetch(req('/api/listings'), env)).json();
  assert.equal(pubAfterApprove.count, 1);
  assert.equal(pubAfterApprove.items[0].title, 'Вилла Turquoise Bay');
  assert.equal(pubAfterApprove.items[0].ownerListing, true);

  // 7. AI Consultant chat -> search_listings + get_listing_details + save_lead + notify admins
  const tgBeforeAi = tgCalls.length;
  const chatRes = await worker.fetch(req('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'sess_test_1',
      text: 'Подскажите по вилле в Анталье, мой контакт @ivan_test',
      name: 'Иван',
      contact: '@ivan_test',
      geo: { country: 'tr', countryName: 'Турция', city: 'Стамбул' },
      onboarding: { goal: 'live', country: 'tr', type: 'Вилла' },
      contextListing: { id: createdProp.id, title: 'Вилла Turquoise Bay', city: 'Анталья', price: '$380 000', ownerListing: true },
    }),
  }), env);
  assert.equal(chatRes.status, 200);
  const chatData = await chatRes.json();
  assert.equal(chatData.ok, true);
  assert.equal(chatData.handedOff, true);
  assert.ok(chatData.reply.includes('Turquoise Bay'));
  const aiTg = tgCalls.slice(tgBeforeAi).filter(c => c.method === 'sendMessage');
  assert.ok(aiTg.length >= 2, 'Assigned manager + other admins must receive lead notification');

  // 8. Handoff & site lead form
  const handoffRes = await worker.fetch(req('/api/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess_test_2', name: 'Пётр', contact: '@petr', note: 'Нужен показ завтра' }),
  }), env);
  assert.equal(handoffRes.status, 200);
  const handoffData = await handoffRes.json();
  assert.equal(handoffData.handedOff, true);

  const leadRes = await worker.fetch(req('/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Анна', contact: '+79120001122', message: 'Хочу виллу', source: 'site_form' }),
  }), env);
  assert.equal(leadRes.status, 200);

  // 9. Admin Telegram commands /cabinet and /pending
  const tgBeforeCmd = tgCalls.length;
  await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({ message: { chat: { id: 11111 }, text: '/cabinet' } }),
  }), env);
  await worker.fetch(req('/api/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec123' },
    body: JSON.stringify({ message: { chat: { id: 11111 }, text: '/pending' } }),
  }), env);
  assert.ok(tgCalls.slice(tgBeforeCmd).some(c => String(c.payload.text || '').includes('Кабинет и объекты')));

  // 10. Ownership check (second user gets 403), owner can PUT and DELETE
  const reg2 = await (await worker.fetch(req('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Чужой', login: 'other@example.com', password: 'password9' }),
  }), env)).json();

  const forbiddenEdit = await worker.fetch(req('/api/cabinet/listings/' + createdProp.id, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + reg2.token, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Hack', city: 'Анталья', price: 100 }),
  }), env);
  assert.equal(forbiddenEdit.status, 403);

  const forbiddenDel = await worker.fetch(req('/api/cabinet/listings/' + createdProp.id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + reg2.token },
  }), env);
  assert.equal(forbiddenDel.status, 403);

  const okEdit = await worker.fetch(req('/api/cabinet/listings/' + createdProp.id, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token1, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Вилла Turquoise Bay Updated', city: 'Анталья', price: 395000, currency: 'USD', type: 'Вилла' }),
  }), env);
  assert.equal(okEdit.status, 200);
  assert.equal((await okEdit.json()).item.title, 'Вилла Turquoise Bay Updated');

  const okDel = await worker.fetch(req('/api/cabinet/listings/' + createdProp.id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token1 },
  }), env);
  assert.equal(okDel.status, 200);

  console.log('ALL TESTS PASSED! Total Telegram API calls exercised:', tgCalls.length);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
