/* Локализация блога Estate Art (RU/EN/TH). Язык синхронизирован с главной (ae_lang). */
(function () {
  'use strict';
  var DICT = {
    en: {
      // индекс
      'Журнал': 'Journal',
      'О недвижимости Пхукета': 'About Phuket real estate',
      'Понятные гайды для тех, кто планирует купить дом или квартиру на острове.': 'Clear guides for those planning to buy a home or apartment on the island.',
      'Как иностранцу купить недвижимость на Пхукете': 'How a foreigner can buy property in Phuket',
      'Пошагово: от выбора объекта и проверки до сделки и получения ключей.': 'Step by step: from choosing and vetting a property to the deal and the keys.',
      'Freehold и leasehold: формы владения и налоги': 'Freehold and leasehold: ownership forms and taxes',
      'Чем отличаются, что доступно иностранцу и какие расходы при покупке.': 'How they differ, what is available to foreigners and the costs of buying.',
      'Районы Пхукета: где покупать под жизнь и аренду': 'Districts of Phuket: where to buy for living and rental',
      'Камала, Банг Тао, Сурин, Раваи, Патонг — кому что подойдёт.': 'Kamala, Bang Tao, Surin, Rawai, Patong — what suits whom.',
      'Читать →': 'Read →', 'На главную': 'Home', 'Главная': 'Home', '← Все статьи': '← All articles',
      'Гайд': 'Guide', 'Право и налоги': 'Law & taxes', 'Локации': 'Locations',
      // общие кнопки/CTA
      'Написать в WhatsApp': 'Message on WhatsApp', 'Смотреть объекты': 'View listings',
      'Спросить у Алены': 'Ask Alena', 'Обсудить с Аленой': 'Discuss with Alena', 'Объекты по районам': 'Listings by district',
      'Поможем пройти путь без рисков': 'We’ll guide you through without risks',
      'Подберём схему владения под вашу ситуацию': 'We’ll arrange an ownership scheme for your case',
      'Подберём район под ваши цели': 'We’ll find a district for your goals',
      // статья 1
      'Покупка недвижимости в Таиланде кажется сложной только до первого разговора с агентом. Разберём весь путь по шагам — от выбора объекта до получения ключей.': 'Buying property in Thailand seems hard only until your first talk with an agent. Let’s break the whole path into steps — from choosing a property to getting the keys.',
      'Шаг 1. Определите цель и бюджет': 'Step 1. Define your goal and budget',
      'Шаг 2. Выберите форму владения': 'Step 2. Choose the ownership form',
      'Шаг 3. Подбор и просмотры': 'Step 3. Selection and viewings',
      'Подбор удобно вести онлайн: видео-туры, фотоотчёты, созвоны. Многие покупают полностью дистанционно. На просмотрах важно честно оценивать плюсы и минусы каждого варианта — это задача вашего агента.': 'Selection is convenient online: video tours, photo reports, calls. Many buy entirely remotely. At viewings it’s important to honestly weigh the pros and cons of each option — that’s your agent’s job.',
      'Шаг 4. Юридическая проверка': 'Step 4. Legal due diligence',
      'проверка прав собственности и обременений;': 'checking ownership rights and encumbrances;',
      'репутация застройщика и история проекта;': 'developer reputation and project history;',
      'условия договора и иностранной квоты (для кондо).': 'contract terms and the foreign quota (for condos).',
      'Эту часть всегда должен сопровождать юрист — это защищает вас от рисков.': 'A lawyer should always handle this part — it protects you from risks.',
      'Шаг 5. Сделка и расчёты': 'Step 5. Deal and payments',
      'После согласования условий вносится депозит, готовится договор, проводятся безопасные расчёты и регистрация. Для новостроя оплата часто идёт поэтапно по мере строительства.': 'Once terms are agreed, a deposit is paid, the contract is prepared, and secure payments and registration are made. For off-plan, payment is often staged as construction progresses.',
      'Шаг 6. После покупки': 'Step 6. After the purchase',
      'Меблировка, подключение управляющей компании и запуск аренды — чтобы недвижимость не простаивала, а приносила доход. Ориентировочную доходность можно прикинуть в калькуляторе на странице любого объекта.': 'Furnishing, a management company and launching rentals — so the property doesn’t sit idle but earns. You can estimate yield with the calculator on any listing page.',
      // статья 2
      'Главный вопрос покупателя-иностранца — как именно оформляется собственность. Разберём два основных варианта и сопутствующие расходы.': 'A foreign buyer’s main question is exactly how ownership is arranged. Let’s look at the two main options and related costs.',
      'Freehold — полная собственность': 'Freehold — full ownership',
      'Leasehold — долгосрочная аренда': 'Leasehold — long-term lease',
      'Что выбрать': 'What to choose', 'Критерий': 'Criterion', 'Тип объекта': 'Property type',
      'чаще кондо': 'usually condo', 'чаще виллы/дома': 'usually villas/houses', 'Срок': 'Term',
      'бессрочно': 'perpetual', '~30 лет + продление': '~30 years + renewal', 'Доступ иностранцу': 'Foreigner access', 'в рамках квоты': 'within quota', 'да': 'yes',
      'Налоги и расходы при покупке': 'Taxes and costs when buying',
      'Точные суммы зависят от объекта и типа сделки, но обычно включают:': 'Exact amounts depend on the property and deal type, but usually include:',
      'регистрационный сбор за передачу права;': 'a transfer registration fee;',
      'гербовый сбор или специальный бизнес-налог;': 'stamp duty or a special business tax;',
      'услуги по оформлению и юридическому сопровождению.': 'processing and legal support services.',
      // статья 3
      'Районы Пхукета: где покупать': 'Districts of Phuket: where to buy',
      'Остров небольшой, но районы очень разные — от тусовочного Патонга до спокойного Най Харна. Вот короткий ориентир под жизнь и под аренду.': 'The island is small but its districts are very different — from lively Patong to calm Nai Harn. Here’s a short guide for living and for rental.',
      'Банг Тао и Лагуна': 'Bang Tao and Laguna', 'Сурин и Камала': 'Surin and Kamala', 'Патонг': 'Patong', 'Раваи и Най Харн': 'Rawai and Nai Harn', 'Чалонг, Катху, Тхаланг': 'Chalong, Kathu, Thalang',
      'Более «жилые» районы вглубь острова — практичный выбор для постоянного проживания и бюджетов поскромнее, с удобной логистикой по острову.': 'More “residential” areas inland — a practical choice for permanent living and tighter budgets, with convenient logistics across the island.',
    },
    th: {
      'Журнал': 'บทความ',
      'О недвижимости Пхукета': 'เรื่องอสังหาฯ ภูเก็ต',
      'Понятные гайды для тех, кто планирует купить дом или квартиру на острове.': 'คู่มือเข้าใจง่ายสำหรับผู้ที่วางแผนซื้อบ้านหรือคอนโดบนเกาะ',
      'Как иностранцу купить недвижимость на Пхукете': 'ชาวต่างชาติซื้ออสังหาฯ ในภูเก็ตอย่างไร',
      'Пошагово: от выбора объекта и проверки до сделки и получения ключей.': 'ทีละขั้น: ตั้งแต่เลือกและตรวจสอบทรัพย์ จนถึงทำสัญญาและรับกุญแจ',
      'Freehold и leasehold: формы владения и налоги': 'Freehold และ leasehold: รูปแบบการถือครองและภาษี',
      'Чем отличаются, что доступно иностранцу и какие расходы при покупке.': 'ต่างกันอย่างไร อะไรที่ชาวต่างชาติทำได้ และค่าใช้จ่ายในการซื้อ',
      'Районы Пхукета: где покупать под жизнь и аренду': 'ทำเลในภูเก็ต: ซื้อที่ไหนเพื่ออยู่อาศัยและปล่อยเช่า',
      'Камала, Банг Тао, Сурин, Раваи, Патонг — кому что подойдёт.': 'กมลา บางเทา สุรินทร์ ราไวย์ ป่าตอง — เหมาะกับใคร',
      'Читать →': 'อ่าน →', 'На главную': 'หน้าแรก', 'Главная': 'หน้าแรก', '← Все статьи': '← บทความทั้งหมด',
      'Гайд': 'คู่มือ', 'Право и налоги': 'กฎหมายและภาษี', 'Локации': 'ทำเล',
      'Написать в WhatsApp': 'แชทผ่าน WhatsApp', 'Смотреть объекты': 'ดูรายการ',
      'Спросить у Алены': 'ถามอาเลน่า', 'Обсудить с Аленой': 'พูดคุยกับอาเลน่า', 'Объекты по районам': 'รายการตามทำเล',
      'Поможем пройти путь без рисков': 'เราจะช่วยคุณตลอดเส้นทางอย่างไร้ความเสี่ยง',
      'Подберём схему владения под вашу ситуацию': 'เราจะจัดรูปแบบการถือครองให้เหมาะกับคุณ',
      'Подберём район под ваши цели': 'เราจะหาทำเลที่ตรงเป้าหมายของคุณ',
      'Покупка недвижимости в Таиланде кажется сложной только до первого разговора с агентом. Разберём весь путь по шагам — от выбора объекта до получения ключей.': 'การซื้ออสังหาฯ ในไทยดูยากแค่ก่อนคุยกับเอเจนต์ครั้งแรก มาดูทุกขั้นตอน — ตั้งแต่เลือกทรัพย์จนรับกุญแจ',
      'Шаг 1. Определите цель и бюджет': 'ขั้นที่ 1 กำหนดเป้าหมายและงบประมาณ',
      'Шаг 2. Выберите форму владения': 'ขั้นที่ 2 เลือกรูปแบบการถือครอง',
      'Шаг 3. Подбор и просмотры': 'ขั้นที่ 3 คัดเลือกและเข้าชม',
      'Подбор удобно вести онлайн: видео-туры, фотоотчёты, созвоны. Многие покупают полностью дистанционно. На просмотрах важно честно оценивать плюсы и минусы каждого варианта — это задача вашего агента.': 'คัดเลือกออนไลน์ได้สะดวก: ทัวร์วิดีโอ ภาพถ่าย วิดีโอคอล หลายคนซื้อทางไกลทั้งหมด การชมควรพิจารณาข้อดีข้อเสียอย่างตรงไปตรงมา — นั่นคือหน้าที่ของเอเจนต์',
      'Шаг 4. Юридическая проверка': 'ขั้นที่ 4 ตรวจสอบทางกฎหมาย',
      'проверка прав собственности и обременений;': 'ตรวจสอบกรรมสิทธิ์และภาระผูกพัน;',
      'репутация застройщика и история проекта;': 'ชื่อเสียงผู้พัฒนาและประวัติโครงการ;',
      'условия договора и иностранной квоты (для кондо).': 'เงื่อนไขสัญญาและโควตาต่างชาติ (สำหรับคอนโด)',
      'Эту часть всегда должен сопровождать юрист — это защищает вас от рисков.': 'ส่วนนี้ควรมีทนายดูแลเสมอ — เพื่อปกป้องคุณจากความเสี่ยง',
      'Шаг 5. Сделка и расчёты': 'ขั้นที่ 5 ทำสัญญาและชำระเงิน',
      'После согласования условий вносится депозит, готовится договор, проводятся безопасные расчёты и регистрация. Для новостроя оплата часто идёт поэтапно по мере строительства.': 'เมื่อตกลงเงื่อนไขแล้ว วางมัดจำ จัดทำสัญญา ชำระเงินอย่างปลอดภัยและจดทะเบียน สำหรับโครงการใหม่มักจ่ายเป็นงวดตามการก่อสร้าง',
      'Шаг 6. После покупки': 'ขั้นที่ 6 หลังการซื้อ',
      'Меблировка, подключение управляющей компании и запуск аренды — чтобы недвижимость не простаивала, а приносила доход. Ориентировочную доходность можно прикинуть в калькуляторе на странице любого объекта.': 'จัดเฟอร์นิเจอร์ ใช้บริษัทบริหาร และเริ่มปล่อยเช่า — เพื่อให้ทรัพย์สร้างรายได้ ประเมินผลตอบแทนได้จากเครื่องคำนวณในแต่ละรายการ',
      'Главный вопрос покупателя-иностранца — как именно оформляется собственность. Разберём два основных варианта и сопутствующие расходы.': 'คำถามหลักของผู้ซื้อต่างชาติคือกรรมสิทธิ์จัดทำอย่างไร มาดูสองรูปแบบหลักและค่าใช้จ่ายที่เกี่ยวข้อง',
      'Freehold — полная собственность': 'Freehold — กรรมสิทธิ์เต็ม',
      'Leasehold — долгосрочная аренда': 'Leasehold — เช่าระยะยาว',
      'Что выбрать': 'เลือกแบบไหน', 'Критерий': 'เกณฑ์', 'Тип объекта': 'ประเภททรัพย์',
      'чаще кондо': 'มักเป็นคอนโด', 'чаще виллы/дома': 'มักเป็นวิลล่า/บ้าน', 'Срок': 'ระยะเวลา',
      'бессрочно': 'ถาวร', '~30 лет + продление': '~30 ปี + ต่ออายุ', 'Доступ иностранцу': 'สิทธิ์ต่างชาติ', 'в рамках квоты': 'ภายในโควตา', 'да': 'ได้',
      'Налоги и расходы при покупке': 'ภาษีและค่าใช้จ่ายในการซื้อ',
      'Точные суммы зависят от объекта и типа сделки, но обычно включают:': 'จำนวนที่แน่นอนขึ้นกับทรัพย์และประเภทธุรกรรม แต่โดยทั่วไปมี:',
      'регистрационный сбор за передачу права;': 'ค่าธรรมเนียมจดทะเบียนโอน;',
      'гербовый сбор или специальный бизнес-налог;': 'อากรแสตมป์หรือภาษีธุรกิจเฉพาะ;',
      'услуги по оформлению и юридическому сопровождению.': 'ค่าดำเนินการและบริการทางกฎหมาย',
      'Районы Пхукета: где покупать': 'ทำเลในภูเก็ต: ซื้อที่ไหน',
      'Остров небольшой, но районы очень разные — от тусовочного Патонга до спокойного Най Харна. Вот короткий ориентир под жизнь и под аренду.': 'เกาะไม่ใหญ่แต่ทำเลต่างกันมาก — ตั้งแต่ป่าตองคึกคักถึงในหานเงียบสงบ นี่คือไกด์สั้น ๆ สำหรับอยู่อาศัยและปล่อยเช่า',
      'Банг Тао и Лагуна': 'บางเทาและลากูน่า', 'Сурин и Камала': 'สุรินทร์และกมลา', 'Патонг': 'ป่าตอง', 'Раваи и Най Харн': 'ราไวย์และในหาน', 'Чалонг, Катху, Тхаланг': 'ฉลอง กะทู้ ถลาง',
      'Более «жилые» районы вглубь острова — практичный выбор для постоянного проживания и бюджетов поскромнее, с удобной логистикой по острову.': 'ย่านที่อยู่อาศัยลึกเข้าไปในเกาะ — ทางเลือกที่เหมาะกับการอยู่ถาวรและงบที่ประหยัด พร้อมการเดินทางสะดวกทั่วเกาะ',
    },
  };

  var lang = 'ru';
  try { var s = localStorage.getItem('ae_lang'); if (s === 'en' || s === 'th' || s === 'ru') lang = s; } catch (e) {}

  function norm(t) { return t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  function walk(l) {
    var els = document.querySelectorAll('h1,h2,h3,h4,p,li,summary,a,span,td,th,b');
    els.forEach(function (el) {
      if (el.children.length) return;
      if (el.closest('header,footer,script,style')) return;
      if (el.dataset.bru == null) el.dataset.bru = el.textContent;
      if (!el.dataset.bru.trim()) return;
      var key = norm(el.dataset.bru);
      var tr = (l !== 'ru' && DICT[l]) ? DICT[l][key] : null;
      el.textContent = (tr != null) ? tr : el.dataset.bru;
    });
    document.documentElement.lang = l;
  }
  function setLang(l) { lang = l; try { localStorage.setItem('ae_lang', l); } catch (e) {} walk(l); updateSw(); }

  var sw;
  function updateSw() { if (sw) sw.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === lang); }); }
  function injectSwitch() {
    var hdr = document.querySelector('.doc-header, .pp-header'); if (!hdr) return;
    sw = document.createElement('div'); sw.className = 'curr-switch blog-lang';
    sw.style.cssText = 'display:inline-flex;background:var(--sand-deep);border-radius:100px;padding:3px;margin-left:auto;margin-right:.8rem';
    ['ru', 'en', 'th'].forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.lang = l; b.textContent = l.toUpperCase();
      b.style.cssText = 'border:0;background:none;font:inherit;font-weight:700;font-size:.78rem;color:var(--ink-soft);padding:.4rem .7rem;border-radius:100px;cursor:pointer';
      b.addEventListener('click', function () { setLang(l); });
      sw.appendChild(b);
    });
    var cta = hdr.querySelector('.header__cta');
    hdr.insertBefore(sw, cta || null);
    var st = document.createElement('style');
    st.textContent = '.blog-lang button.is-active{background:var(--teal);color:#fff}';
    document.head.appendChild(st);
  }

  function init() { injectSwitch(); walk(lang); updateSw(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
