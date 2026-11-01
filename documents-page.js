(function () {
  'use strict';
  const AUTH_API = 'https://app.daldobro.ru';
  const PREFIX = '/cabinet-api/v1';
  const controllers = new Set();
  let view = null;
  let closed = false;
  const el = id => document.getElementById(id);
  function token() { try { return localStorage.getItem('dd_token') || ''; } catch (_) { return ''; } }
  function showLogin() {
    if (view) { view.destroy(); view = null; }
    el('cabLoading').hidden = true;
    el('cabDocuments').hidden = true;
    el('cabAccount').hidden = true;
    el('cabUnavailable').hidden = true;
    el('cabLogin').hidden = false;
  }
  function requestError(status, code) {
    const messages = {401:'Войдите в свой кабинет.',404:'Документ или папка не найдены.',409:'Данные изменились. Обновите список и повторите правку.',413:'Размер файла — до 20 МБ.',415:'Добавьте фото JPG, PNG, WebP или PDF.',422:'Проверьте название и реквизиты.',429:'Обрабатываем предыдущие файлы. Попробуйте чуть позже.'};
    const err = new Error(messages[status] || 'Не удалось выполнить действие. Попробуйте ещё раз.');
    err.status = status; err.code = code || 'request_failed';
    return err;
  }
  async function call(path, options) {
    const opts = options || {};
    const current = token();
    if (!current) { showLogin(); throw requestError(401,'auth_required'); }
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), opts.upload ? 180000 : 30000);
    try {
      const response = await fetch(AUTH_API + path, {
        method: opts.method || 'GET',
        headers: Object.assign({Authorization:'Bearer ' + current}, opts.headers || {}),
        body: opts.body,
        cache:'no-store',
        signal:controller.signal
      });
      // A response from a previous account must never enter the next cabinet.
      if (closed || current !== token()) throw requestError(401,'account_changed');
      if (response.status === 401) showLogin();
      const json = (response.headers.get('content-type') || '').includes('application/json');
      if (!response.ok) {
        let code = 'request_failed';
        if (json) { const failure = await response.json(); if (failure.error && typeof failure.error.code === 'string') code = failure.error.code; }
        throw requestError(response.status, code);
      }
      if (opts.blob) {
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(mime)) throw requestError(502);
        return response.blob();
      }
      if (!json) throw requestError(502);
      return response.json();
    } catch (err) {
      if (err.name === 'AbortError') { const e = requestError(408,'request_timeout'); e.message = 'Сервер не ответил вовремя. Попробуйте ещё раз.'; throw e; }
      if (!err.status) throw requestError(503,'connection_failed');
      throw err;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function post(path, body) { return call(PREFIX + path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body || {})}); }
  const api = {
    listWorkspace: () => call(PREFIX + '/workspace'),
    uploadFile: (file, context) => {
      if (file.size > 20 * 1024 * 1024) return Promise.reject(requestError(413,'too_large'));
      const headers = {'Content-Type':'application/octet-stream','X-Document-Name':encodeURIComponent(file.name || 'Фото.jpg')};
      if (context && context.deal_id) headers['X-Deal-Id'] = context.deal_id;
      if (context && context.client_id) headers['X-Client-Id'] = context.client_id;
      return call(PREFIX + '/documents',{method:'POST',headers,body:file,upload:true});
    },
    retryDocument: id => post('/documents/' + encodeURIComponent(id) + '/retry',{}),
    renameClient: (id, body) => post('/clients/' + encodeURIComponent(id),body),
    renameDeal: (id, body) => post('/deals/' + encodeURIComponent(id),body),
    moveDocument: (id, body) => post('/documents/' + encodeURIComponent(id) + '/move',body),
    createClient: body => post('/clients',body),
    createDeal: body => post('/deals',body),
    openOriginal: id => call(PREFIX + '/documents/' + encodeURIComponent(id) + '/original',{blob:true})
  };
  async function start() {
    if (!token()) { showLogin(); return; }
    try {
      const identity = await call('/auth/me');
      if (closed) return;
      if (!identity.auth) { showLogin(); return; }
      el('cabEmail').textContent = identity.email || '';
      el('cabEmail').title = identity.email || '';
      el('cabAccount').hidden = false;
      el('cabLoading').hidden = true;
      el('cabDocuments').hidden = false;
      // Trial/payment status never gates this document workflow.
      view = window.DalDobroDocuments.mount({root:el('cabDocuments'),api});
    } catch (err) {
      if (closed || err.status === 401) return;
      el('cabLoading').hidden = true;
      el('cabUnavailable').hidden = false;
    }
  }
  el('cabLogout').addEventListener('click', () => {
    closed = true;
    try { localStorage.removeItem('dd_token'); } catch (_) {}
    controllers.forEach(controller => controller.abort());
    showLogin();
  });
  window.addEventListener('pagehide', () => {
    closed = true;
    if (view) view.destroy();
    controllers.forEach(controller => controller.abort());
    controllers.clear();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  window.addEventListener('storage', event => {
    if ((event.key === 'dd_token' && event.oldValue !== event.newValue) || event.key === null) {
      closed = true;
      controllers.forEach(controller => controller.abort());
      showLogin();
      // Reinitialize both identity and workspace when another tab switches accounts.
      location.reload();
    }
  });
  start();
}());
