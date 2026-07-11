/* ДалДобро — встраиваемый калькулятор растаможки из Китая.
   Вставьте на страницу:  <div id="daldobro-calc"></div><script src="https://daldobro.ru/widget.js" async></script>
   Виджет = iframe с калькулятором + видимая ссылка на источник (для SEO хоста и нашего бренда). */
(function () {
  function mount(box) {
    if (!box || box.getAttribute('data-dd') === '1') return;
    box.setAttribute('data-dd', '1');
    var wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:460px;margin:0 auto;border:1px solid #2a3550;border-radius:14px;overflow:hidden;background:#0a0f1c';
    var ifr = document.createElement('iframe');
    ifr.src = 'https://daldobro.ru/embed.html';
    ifr.title = 'Калькулятор растаможки из Китая — ДалДобро';
    ifr.loading = 'lazy';
    ifr.style.cssText = 'width:100%;height:430px;border:0;display:block';
    wrap.appendChild(ifr);
    // видимая ссылка-подпись (проходит как SEO-ссылка на странице хоста)
    var cap = document.createElement('div');
    cap.style.cssText = 'font:12px -apple-system,Segoe UI,Arial;color:#8a97b5;padding:7px 10px;text-align:center;background:#0a0f1c';
    cap.innerHTML = 'Калькулятор ввоза из Китая — <a href="https://daldobro.ru/" target="_blank" style="color:#5b8cff;text-decoration:none">ДалДобро</a>: код ТН ВЭД, пошлина, НДС, ставки';
    wrap.appendChild(cap);
    box.appendChild(wrap);
  }
  function init() {
    var boxes = document.querySelectorAll('#daldobro-calc,[data-daldobro-calc]');
    if (boxes.length) { for (var i = 0; i < boxes.length; i++) mount(boxes[i]); return; }
    // если контейнера нет — монтируем рядом со скриптом
    var s = document.currentScript || (function () { var a = document.getElementsByTagName('script'); return a[a.length - 1]; })();
    if (s && s.parentNode) { var d = document.createElement('div'); s.parentNode.insertBefore(d, s.nextSibling); mount(d); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
