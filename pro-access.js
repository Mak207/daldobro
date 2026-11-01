/* Private PRO data is requested only from the API; URL flags never grant access. */
(function () {
  const API = 'https://app.daldobro.ru';
  let serial = 0, active;
  window.ddProLoad = function (name, render) {
    let access = document.getElementById('proAccess');
    if (!access) {
      access = document.createElement('div'); access.id = 'proAccess';
      access.style.cssText = 'margin:12px 0 18px;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px';
      access.innerHTML = '<a href="/login.html">Войти в аккаунт подписчика</a> · или введите ключ из письма: <input id="proKey" type="password" autocomplete="off" placeholder="Ключ Индексы PRO" style="max-width:240px;margin:6px;padding:8px;border-radius:8px"><button id="proOpen" type="button" style="padding:8px;border-radius:8px">Открыть</button><div id="proError" role="status"></div>';
      const fresh = document.getElementById('fresh'); fresh.after(access);
    }
    async function load() {
      const sequence = ++serial;
      if (active) active.abort();
      active = new AbortController(); const controller = active;
      const timeout = setTimeout(() => controller.abort(), 20000);
      const error = document.getElementById('proError'); error.textContent = '';
      const button = document.getElementById('proOpen'); button.disabled = true;
      try {
        const headers = {};
        const token = localStorage.getItem('dd_token');
        const key = sessionStorage.getItem('dd_pro_key');
        if (token) headers.Authorization = 'Bearer ' + token;
        if (key) headers['X-Pro-Key'] = key;
        const response = await fetch(API + '/pro/content/' + name, {headers, cache:'no-store', signal:controller.signal});
        if (!response.ok) throw new Error(response.status === 403 ? 'Ключ не найден или срок подписки истёк. Проверьте ключ из письма.' : 'Раздел временно недоступен. Попробуйте ещё раз.');
        if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Не удалось получить данные раздела. Попробуйте ещё раз.');
        const data = await response.json();
        if (sequence !== serial) return;
        if (!data.payload || !data.payload.DATA) throw new Error('Не удалось получить данные раздела.');
        document.body.classList.toggle('paid', data.gated === false);
        document.getElementById('fresh').textContent = 'Дата данных: ' + (data.updated || 'не указана') + (data.stale ? '. Архивная версия — актуальная сводка пока не опубликована.' : '.');
        render(data);
      } catch (e) {
        if (sequence !== serial) return;
        error.textContent = e.name === 'AbortError' ? 'Сервер не ответил вовремя. Попробуйте ещё раз.' : e.message;
      } finally {
        clearTimeout(timeout);
        if (sequence === serial) button.disabled = false;
      }
    }
    document.getElementById('proOpen').onclick = function () {
      const key = document.getElementById('proKey').value.trim();
      if (key) sessionStorage.setItem('dd_pro_key', key); else sessionStorage.removeItem('dd_pro_key');
      document.getElementById('proKey').value = ''; load();
    };
    document.getElementById('proKey').addEventListener('keydown', e => {if (e.key === 'Enter') document.getElementById('proOpen').click();});
    load();
  };
})();
