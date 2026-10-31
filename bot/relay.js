/* ============================================================
   Реле запросов к Anthropic, прибитое к региону.

   Воркер выполняется в ближайшей к посетителю точке — для нашей
   аудитории это Гонконг, а оттуда защита перед API Anthropic
   отбивает запросы: 403 отдаёт Cloudflare, в ответе нет ни одного
   заголовка anthropic-*. Проверено: восемь из восьми отказов с
   colo=HKG, при том что тот же запрос с обычной машины проходит.

   Durable Object — единственный способ задать регион выполнения
   явно: locationHint при создании закрепляет объект за регионом,
   и все обращения к Anthropic идут уже оттуда.
   ============================================================ */

export class AnthropicRelay {
  constructor(state, env) {
    this.env = env;
  }

  async fetch(request) {
    const body = await request.text();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'user-agent': 'estate-art-chat/1.0',
      },
      body,
    });
    const text = await r.text();
    const ray = r.headers.get('cf-ray') || '';
    return new Response(text, {
      status: r.status,
      headers: {
        'content-type': 'application/json',
        'x-relay-colo': ray.split('-')[1] || '?',
      },
    });
  }
}
