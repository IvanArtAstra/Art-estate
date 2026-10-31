/* ============================================================
   Estate Art — сайт внутри Telegram (Mini App).

   Открывается кнопкой меню бота. Внутри Telegram сайт должен
   вести себя как часть приложения, а не как страница в браузере:
   без дублирующих кнопок мессенджеров (человек уже в Telegram),
   без своего чата (он говорит с тем же ботом этажом выше) и без
   свайпа, который закрывает приложение посреди прокрутки.

   Вне Telegram модуль не делает ничего.
   ============================================================ */
(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;

  const root = document.documentElement;
  root.classList.add('in-telegram');

  try { tg.ready(); } catch (e) {}
  try { tg.expand(); } catch (e) {}

  // Цвет шапки и фона — под полотно загрузки, чтобы стык не бросался в глаза
  const INK = '#082825';
  try { tg.setHeaderColor(INK); } catch (e) {}
  try { tg.setBackgroundColor(INK); } catch (e) {}

  /* Свайп вниз в Telegram закрывает мини-апп. На сайте, где первый экран —
     скролл-облёт видео, это означает, что человек закрывает приложение ровно
     тогда, когда пытается его посмотреть. Метод появился в Bot API 7.7;
     на старых клиентах его просто нет. */
  try { tg.disableVerticalSwipes(); } catch (e) {}

  // Высота окна мини-аппа отличается от 100vh и меняется при раскрытии
  function syncHeight() {
    const h = tg.viewportStableHeight || tg.viewportHeight;
    if (h) root.style.setProperty('--tg-viewport', h + 'px');
  }
  syncHeight();
  try { tg.onEvent('viewportChanged', syncHeight); } catch (e) {}

  /* Ссылки на Telegram изнутри Telegram открываем нативно, а не новой
     вкладкой браузера: иначе клиент уводит человека в веб-версию. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="https://t.me/"]');
    if (!a) return;
    e.preventDefault();
    try { tg.openTelegramLink(a.href); } catch (err) { window.location.href = a.href; }
  });
})();
