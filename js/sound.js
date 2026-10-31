/* ============================================================
   ESTATE ART — звуковой слой
   ------------------------------------------------------------
   Мягкие щелчки на действия: нажатие, открытие и закрытие слоя,
   отказ, отправка заявки. Звуки синтезируются Web Audio прямо на
   месте — ни одного файла не качается, весь слой весит пару
   килобайт и молчит, пока его не включили.

   Выключен по умолчанию. Первый клик анонимного посетителя — это
   навигация или карточка; прозвучав там, звук сообщает о себе в
   момент, когда его не просили, и на премиальной недвижимости
   читается как баннер. Выбор живёт в localStorage.
   ============================================================ */
(function () {
  'use strict';

  const KEY = 'ea_sound';
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let enabled = false;
  try { enabled = localStorage.getItem(KEY) === 'on'; } catch (e) {}

  let ctx = null;
  let bus = null;        // общая шина громкости
  let noise = null;      // буфер шума для «деревянной» составляющей щелчка
  let last = 0;          // защита от очереди щелчков при быстром клике

  function context() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = 0.9;
    // Срезаем верх: без фильтра синтезированный щелчок звучит как
    // пластиковый «тик» из бесплатных наборов
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 5200;
    soft.Q.value = 0.4;
    bus.connect(soft);
    soft.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 0.08);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return ctx;
  }

  /* Тон: синус с мягкой атакой и экспоненциальным спадом.
     Атака в 6 мс убирает «клик» самого включения осциллятора. */
  function tone(freq, dur, vol, delay, type) {
    const c = context(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(bus);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /* Короткий призвук дерева: полосовой шум поверх тона.
     Именно он отличает щелчок от писка. */
  function knock(freq, vol, delay) {
    const c = context(); if (!c || !noise) return;
    const t0 = c.currentTime + (delay || 0);
    const s = c.createBufferSource();
    s.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.6;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    s.connect(bp); bp.connect(g); g.connect(bus);
    s.start(t0); s.stop(t0 + 0.09);
  }

  const VOICES = {
    // нажатие: тихий деревянный щелчок, 18 мс — не нота, а касание
    tap:     () => { knock(1750, 0.05, 0);   tone(392, 0.05, 0.016); },
    // открытие слоя: две ступени вверх, как приоткрытая створка
    open:    () => { tone(392, 0.11, 0.028); tone(587, 0.16, 0.022, 0.055); knock(1500, 0.03, 0); },
    // закрытие: те же ступени вниз
    close:   () => { tone(523, 0.10, 0.024); tone(349, 0.16, 0.020, 0.05); },
    // отказ: глухой упор без диссонанса — не ошибка, а предел
    block:   () => { tone(174, 0.17, 0.034, 0, 'triangle'); knock(420, 0.035, 0); },
    // отправлено: мягкое трезвучие
    success: () => { tone(523, 0.14, 0.024); tone(659, 0.16, 0.021, 0.07); tone(784, 0.26, 0.019, 0.14); },
  };

  const Sound = {
    get enabled() { return enabled; },
    available: !!(window.AudioContext || window.webkitAudioContext),

    play(name) {
      if (!enabled || mqReduce.matches) return;
      const v = VOICES[name]; if (!v) return;
      const now = performance.now();
      // Не больше одного щелчка в 45 мс: иначе быстрый клик по сетке
      // складывается в треск
      if (name === 'tap' && now - last < 45) return;
      last = now;
      const c = context(); if (!c) return;
      if (c.state === 'suspended') c.resume().catch(() => {});
      try { v(); } catch (e) {}
    },

    set(on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) {}
      document.documentElement.classList.toggle('sound-on', enabled);
      // Включение сразу слышно — иначе непонятно, что произошло
      if (enabled) { context(); Sound.play('open'); }
      return enabled;
    },

    toggle() { return Sound.set(!enabled); },
  };

  document.documentElement.classList.toggle('sound-on', enabled);
  window.Sound = Sound;
})();
