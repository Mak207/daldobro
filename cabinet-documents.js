(function (global) {
  "use strict";

  const POLL_MS = 4500;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_UPLOADS = 2;
  const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  const PENDING = new Set(["queued", "processing"]);
  const STATUSES = new Set(["queued", "processing", "ready", "needs_attention", "error"]);
  const mounted = new WeakMap();
  let mountNumber = 0;

  const LABELS = {
    queued: "Распределяем по папкам",
    processing: "Распределяем по папкам",
    ready: "Готово",
    needs_attention: "Папку можно уточнить",
    error: "Не удалось обработать"
  };

  const ERROR_MESSAGES = {
    FILE_TOO_LARGE: "Файл больше 20 МБ. Добавьте файл меньшего размера.",
    EMPTY_FILE: "Файл пустой. Выберите другой файл.",
    UNSUPPORTED_FILE_TYPE: "Поддерживаются JPG, PNG, WebP и PDF.",
    UNSUPPORTED_TYPE: "Поддерживаются JPG, PNG, WebP и PDF.",
    UNSUPPORTED_MIME: "Поддерживаются JPG, PNG, WebP и PDF.",
    INVALID_FILE: "Не удалось открыть файл. Проверьте его и добавьте снова.",
    DOCUMENT_UNREADABLE: "Не удалось обработать файл. Попробуйте более чёткое фото.",
    UNREADABLE_DOCUMENT: "Не удалось разобрать документ. Добавьте более чёткое фото или другой файл.",
    IMAGE_TOO_LARGE: "Изображение слишком большое. Добавьте фото меньшего размера или отдельные части документа.",
    ATTEMPT_LIMIT: "Повторная обработка не помогла. Добавьте другое фото или нужные страницы отдельным файлом.",
    DOC_TOO_LONG: "Документ слишком длинный. Добавьте нужные страницы отдельным файлом.",
    PARTIAL_DOCUMENT: "Папка создана. При необходимости можно уточнить размещение документа.",
    OCR_FAILED: "Не удалось обработать документ. Можно попробовать ещё раз.",
    PROCESSING_FAILED: "Не удалось распределить документ. Можно попробовать ещё раз.",
    PROCESSING_TIMEOUT: "Обработка заняла слишком много времени. Можно попробовать ещё раз.",
    ENGINE_UNAVAILABLE: "Обработка временно недоступна. Можно попробовать ещё раз позже.",
    TIMEOUT: "Обработка заняла слишком много времени. Попробуйте ещё раз.",
    VERSION_CONFLICT: "Данные изменились. Закройте редактирование и откройте его снова.",
    CONFLICT: "Данные изменились. Закройте редактирование и откройте его снова.",
    FORBIDDEN: "У вас нет доступа к этому действию.",
    UNAUTHORIZED: "Сессия завершилась. Обновите кабинет.",
    AUTH_REQUIRED: "Сессия завершилась. Обновите кабинет.",
    NOT_FOUND: "Документ или папка больше недоступны. Обновите список.",
    DOCUMENT_NOT_FOUND: "Документ больше недоступен. Обновите список.",
    FILE_NOT_FOUND: "Оригинал документа больше недоступен.",
    ORIGINAL_UNAVAILABLE: "Не удалось открыть оригинал. Попробуйте позже.",
    NETWORK_ERROR: "Не удалось связаться с сервером. Попробуйте ещё раз."
  };
  const RECOVERABLE = new Set(["PROCESSING_TIMEOUT", "ENGINE_UNAVAILABLE", "PROCESSING_FAILED"]);
  const KIND_LABELS = {
    invoice: "Счёт", contract: "Договор", offer: "Коммерческое предложение",
    act: "Акт", transport: "Транспортный документ", other: "Документ"
  };

  const ICONS = {
    camera: ["M4 6h4l2-3h4l2 3h4v14H4z", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0"],
    upload: ["M12 16V3m-5 5 5-5 5 5", "M4 15v6h16v-6"],
    folder: ["M3 6h7l2 3h9v12H3z"],
    file: ["M6 3h8l4 4v14H6z", "M14 3v5h4M9 12h6M9 16h6"],
    back: ["m14 6-6 6 6 6"],
    edit: ["m4 16 12-12 4 4L8 20H4z", "m13 7 4 4"],
    plus: ["M12 4v16M4 12h16"],
    close: ["m6 6 12 12M18 6 6 18"],
    refresh: ["M20 7v5h-5", "M4 17v-5h5", "M6 6a8 8 0 0 1 13 4M18 18a8 8 0 0 1-13-4"],
    open: ["M14 3h7v7M21 3l-11 11", "M10 3H3v18h18v-7"],
    move: ["M3 6h7l2 3h9v12H3z", "M8 15h8m-3-3 3 3-3 3"],
    check: ["m5 12 4 4L19 6"]
  };

  function text(value, fallback) {
    return typeof value === "string" ? value : (fallback || "");
  }

  function version(value) {
    return typeof value === "string" || typeof value === "number" ? value : undefined;
  }

  // Public-field allowlist. The UI never retains an OCR/transcript payload.
  function clientRecord(value) {
    if (!value || typeof value.id !== "string" || !value.id) throw new Error("INVALID_RESPONSE");
    return { id: value.id, name: text(value.name, "Клиент"), inn: text(value.inn), version: version(value.version) };
  }

  function dealRecord(value) {
    if (!value || typeof value.id !== "string" || !value.id) throw new Error("INVALID_RESPONSE");
    return {
      id: value.id, client_id: text(value.client_id), name: text(value.name, "Сделка"),
      contract_number: text(value.contract_number), version: version(value.version)
    };
  }

  function documentRecord(value) {
    if (!value || typeof value.id !== "string" || !value.id) throw new Error("INVALID_RESPONSE");
    return {
      id: value.id, filename: text(value.filename, "Документ"), mime_type: text(value.mime_type),
      size: Number.isFinite(value.size) && value.size >= 0 ? value.size : 0,
      status: STATUSES.has(value.status) ? value.status : "needs_attention",
      client_id: text(value.client_id), deal_id: text(value.deal_id), kind: text(value.kind),
      created_at: text(value.created_at), version: version(value.version), error_code: text(value.error_code)
    };
  }

  function workspaceRecord(value) {
    if (!value || !Array.isArray(value.clients) || !Array.isArray(value.deals) || !Array.isArray(value.documents)) {
      throw new Error("INVALID_RESPONSE");
    }
    return {
      clients: value.clients.map(clientRecord),
      deals: value.deals.map(dealRecord),
      documents: value.documents.map(documentRecord)
    };
  }

  function codeOf(error) {
    if (!error || typeof error !== "object") return "";
    return text(error.code || error.error_code).toUpperCase();
  }

  function safeError(error, fallback) {
    const code = codeOf(error);
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    const status = Number(error && (error.status || error.statusCode));
    if (status === 401) return ERROR_MESSAGES.UNAUTHORIZED;
    if (status === 403) return ERROR_MESSAGES.FORBIDDEN;
    if (status === 404) return ERROR_MESSAGES.NOT_FOUND;
    if (status === 409) return ERROR_MESSAGES.VERSION_CONFLICT;
    if (status === 413) return ERROR_MESSAGES.FILE_TOO_LARGE;
    if (status === 415) return ERROR_MESSAGES.UNSUPPORTED_FILE_TYPE;
    // Never display error.message: it can contain a server trace or document text.
    return fallback || "Не удалось выполнить действие. Попробуйте ещё раз.";
  }

  function fileError(file) {
    if (!file || file.size === 0) return "EMPTY_FILE";
    if (file.size > MAX_FILE_BYTES) return "FILE_TOO_LARGE";
    const mime = text(file.type).toLowerCase().split(";")[0];
    if (MIME_TYPES.has(mime)) return "";
    if (!mime && /\.(jpe?g|png|webp|pdf)$/i.test(file.name || "")) return "";
    return "UNSUPPORTED_FILE_TYPE";
  }

  function formatSize(size) {
    if (!size) return "";
    return size >= 1024 * 1024
      ? (size / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " МБ"
      : Math.max(1, Math.round(size / 1024)).toLocaleString("ru-RU") + " КБ";
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru-RU");
  }

  function mount(options) {
    const root = options && options.root;
    const api = options && options.api;
    if (!root || root.nodeType !== 1 || !root.ownerDocument) throw new TypeError("root must be a DOM element");
    const required = ["listWorkspace", "uploadFile", "retryDocument", "renameClient", "renameDeal", "moveDocument", "createClient", "createDeal", "openOriginal"];
    for (const name of required) {
      if (!api || typeof api[name] !== "function") throw new TypeError("Missing API adapter method: " + name);
    }
    const previous = mounted.get(root);
    if (previous) previous.destroy();

    const doc = root.ownerDocument;
    const win = doc.defaultView || global;
    const controller = new win.AbortController();
    const prefix = "dd-documents-" + (++mountNumber) + "-";
    const urls = new Set();
    const urlTimers = new Set();
    const waitingWindows = new Set();
    const locks = new Set();
    const completedUploads = new Set();
    let destroyed = false;
    let data = { clients: [], deals: [], documents: [] };
    let clientMap = new Map();
    let dealMap = new Map();
    let documentMap = new Map();
    let view = { clientId: "", dealId: "" };
    let loaded = false;
    let loading = false;
    let listError = "";
    let notice = null;
    let editor = null;
    let editorNumber = 0;
    let uploadNumber = 0;
    let uploadRows = [];
    let activeUploads = 0;
    let activeMutations = 0;
    let epoch = 0;
    let readSequence = 0;
    let readPromise = null;
    let refreshAgain = false;
    let pollTimer = null;
    let showAllPending = false;

    function el(tag, attributes, children) {
      const result = doc.createElement(tag);
      for (const [key, value] of Object.entries(attributes || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "text") result.textContent = String(value);
        else if (key === "className") result.className = value;
        else if (key === "value") result.value = value;
        else if (key === "disabled") result.disabled = Boolean(value);
        else result.setAttribute(key, value === true ? "" : String(value));
      }
      for (const child of children || []) {
        if (child !== null && child !== undefined) result.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
      }
      return result;
    }

    function icon(name) {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "dd-docs__icon" })) svg.setAttribute(key, value);
      for (const d of ICONS[name] || ICONS.file) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
      }
      return svg;
    }

    function button(label, action, id, options) {
      const opts = options || {};
      const result = el("button", {
        type: "button", className: "dd-docs__button " + (opts.className || ""),
        "data-dd-action": action, "data-id": id || undefined,
        disabled: opts.disabled, "aria-label": opts.ariaLabel || undefined,
        title: opts.title || undefined
      });
      if (opts.icon) result.appendChild(icon(opts.icon));
      if (label) result.appendChild(el("span", { text: label }));
      return result;
    }

    const shell = el("section", { className: "dd-docs", "aria-label": "Документы" });
    const heading = el("div", { className: "dd-docs__heading" }, [
      el("div", {}, [el("h1", { className: "dd-docs__title", text: "Документы" }), el("p", { className: "dd-docs__subtitle", text: "Добавьте документ — создадим папки клиента и сделки автоматически." })]),
      button("Обновить", "refresh", "", { icon: "refresh", className: "dd-docs__button--quiet", ariaLabel: "Обновить список документов" })
    ]);
    const cameraInput = el("input", { type: "file", accept: "image/*", capture: "environment", className: "dd-docs__file-input", tabindex: "-1", "aria-hidden": "true" });
    const filesInput = el("input", { type: "file", accept: ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf", multiple: true, className: "dd-docs__file-input", tabindex: "-1", "aria-hidden": "true" });
    const contextHint = el("p", { className: "dd-docs__context" });
    const toolbar = el("div", { className: "dd-docs__toolbar" }, [
      el("div", { className: "dd-docs__upload-buttons" }, [
        button("Сфотографировать", "camera", "", { icon: "camera", className: "dd-docs__button--primary" }),
        button("Добавить файлы", "files", "", { icon: "upload" })
      ]),
      el("span", { className: "dd-docs__formats", text: "JPG, PNG, WebP, PDF · до 20 МБ на файл" }),
      contextHint, cameraInput, filesInput
    ]);
    const status = el("div", { className: "dd-docs__live-status", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const noticeBox = el("div", { className: "dd-docs__notice", hidden: true });
    const uploadsBox = el("div", { className: "dd-docs__uploads", hidden: true });
    const crumbs = el("nav", { className: "dd-docs__breadcrumbs", "aria-label": "Папки документов" });
    const editorBox = el("div", { className: "dd-docs__editor", hidden: true });
    const content = el("div", { className: "dd-docs__content" });
    shell.append(heading, toolbar, status, noticeBox, uploadsBox, crumbs, editorBox, content);
    root.appendChild(shell);

    function reindex() {
      clientMap = new Map(data.clients.map(item => [item.id, item]));
      dealMap = new Map(data.deals.map(item => [item.id, item]));
      documentMap = new Map(data.documents.map(item => [item.id, item]));
      if (view.clientId && !clientMap.has(view.clientId)) view = { clientId: "", dealId: "" };
      if (view.dealId) {
        const selectedDeal = dealMap.get(view.dealId);
        if (!selectedDeal) view.dealId = "";
        else if (clientMap.has(selectedDeal.client_id)) view.clientId = selectedDeal.client_id;
        else view = { clientId: "", dealId: "" };
      }
    }

    function upsert(collection, item) {
      const index = data[collection].findIndex(existing => existing.id === item.id);
      if (index < 0) data[collection].push(item);
      else data[collection][index] = item;
      reindex();
    }

    function effectiveClient(item) {
      const deal = dealMap.get(item.deal_id);
      return deal ? deal.client_id : item.client_id;
    }

    function pendingDocuments() {
      return data.documents.filter(item => PENDING.has(item.status));
    }

    function notify(message, level, destination) {
      notice = { message, level: level || "success", destination: destination || "" };
      renderNotice();
    }

    function renderNotice() {
      if (destroyed) return;
      noticeBox.replaceChildren();
      noticeBox.hidden = !notice;
      if (!notice) return;
      noticeBox.className = "dd-docs__notice dd-docs__notice--" + notice.level;
      noticeBox.setAttribute("role", notice.level === "error" ? "alert" : "status");
      noticeBox.append(el("span", { text: notice.message }));
      if (notice.destination && dealMap.has(notice.destination)) noticeBox.append(button("Открыть папку", "deal", notice.destination, { className: "dd-docs__button--small" }));
      noticeBox.append(button("", "dismiss-notice", "", { icon: "close", className: "dd-docs__button--icon", ariaLabel: "Скрыть уведомление" }));
    }

    function updateLiveStatus() {
      const waiting = uploadRows.filter(item => item.state === "waiting" || item.state === "uploading").length;
      const pending = pendingDocuments().length;
      let message = "";
      if (waiting) message = "Загружаем файлы: " + waiting + ". Дождитесь завершения загрузки; дальше документы обрабатываются в фоне.";
      else if (pending) message = "Распределяем по папкам: " + pending + ". Можно закрыть раздел — обработка продолжится.";
      else if (loading && !loaded) message = "Загружаем список документов…";
      if (status.textContent !== message) status.textContent = message;
      status.hidden = !message;
      const currentDeal = dealMap.get(view.dealId);
      const currentClient = clientMap.get(view.clientId);
      contextHint.textContent = currentDeal ? "Добавление в сделку «" + currentDeal.name + "»." : currentClient ? "Для клиента «" + currentClient.name + "». Сделку определим автоматически." : "Клиента и сделку определим автоматически. Названия и папки можно изменить позже.";
      const refreshButton = heading.querySelector('[data-dd-action="refresh"]');
      if (refreshButton) refreshButton.disabled = loading;
    }

    function renderUploads() {
      const visible = uploadRows.filter(item => item.state !== "uploaded");
      uploadsBox.hidden = visible.length === 0;
      uploadsBox.replaceChildren();
      if (!visible.length) return;
      uploadsBox.append(el("h2", { className: "dd-docs__section-title", text: "Добавление файлов" }));
      for (const item of visible) {
        const line = el("div", { className: "dd-docs__upload-row" }, [icon("file"), el("div", { className: "dd-docs__upload-info" }, [
          el("span", { className: "dd-docs__filename", text: item.name }),
          el("span", { className: item.state === "error" ? "dd-docs__error-text" : "dd-docs__muted", text: item.state === "uploading" ? "Загрузка…" : item.state === "waiting" ? "Ожидает загрузки" : item.error })
        ])]);
        if (item.state === "error") {
          if (item.file && !item.validationError) line.append(button("Повторить загрузку", "retry-upload", item.id, { className: "dd-docs__button--small" }));
          line.append(button("", "remove-upload", item.id, { icon: "close", className: "dd-docs__button--icon", ariaLabel: "Убрать файл из списка" }));
        }
        uploadsBox.append(line);
      }
    }

    function breadcrumb(label, action, id, current) {
      if (current) return el("span", { className: "dd-docs__crumb-current", text: label, "aria-current": "page" });
      return button(label, action, id, { className: "dd-docs__crumb" });
    }

    function renderBreadcrumbs() {
      crumbs.replaceChildren();
      if (view.clientId) crumbs.append(button("Назад", "back", "", { icon: "back", className: "dd-docs__button--quiet dd-docs__back" }));
      crumbs.append(breadcrumb("Все клиенты", "home", "", !view.clientId));
      if (view.clientId) {
        crumbs.append(el("span", { className: "dd-docs__crumb-separator", text: "/", "aria-hidden": "true" }));
        crumbs.append(breadcrumb(clientMap.get(view.clientId).name, "client", view.clientId, !view.dealId));
      }
      if (view.dealId) {
        crumbs.append(el("span", { className: "dd-docs__crumb-separator", text: "/", "aria-hidden": "true" }));
        crumbs.append(breadcrumb(dealMap.get(view.dealId).name, "deal", view.dealId, true));
      }
    }

    function emptyState(title, description) {
      return el("div", { className: "dd-docs__empty" }, [
        el("div", { className: "dd-docs__empty-icon" }, [icon("folder")]),
        el("h3", { text: title }), el("p", { text: description })
      ]);
    }

    function sectionHeading(title, subtitle, actionButton) {
      const row = el("div", { className: "dd-docs__section-heading" }, [
        el("div", {}, [el("h2", { className: "dd-docs__section-title", text: title }), subtitle ? el("p", { className: "dd-docs__section-subtitle", text: subtitle }) : null])
      ]);
      if (actionButton) row.append(actionButton);
      return row;
    }

    function folderCard(item, type, subtitle) {
      return el("div", { className: "dd-docs__folder-card" }, [
        el("button", { type: "button", className: "dd-docs__folder-main", "data-dd-action": type, "data-id": item.id }, [
          el("span", { className: "dd-docs__folder-icon" }, [icon("folder")]),
          el("span", { className: "dd-docs__folder-name", text: item.name }),
          el("span", { className: "dd-docs__folder-meta", text: subtitle })
        ]),
        button("", "rename-" + type, item.id, { icon: "edit", className: "dd-docs__button--icon dd-docs__folder-edit", ariaLabel: "Изменить название «" + item.name + "»", disabled: locks.has(type + ":" + item.id) })
      ]);
    }

    function canRetry(item) {
      return (item.status === "needs_attention" || item.status === "error") && RECOVERABLE.has(item.error_code.toUpperCase());
    }

    function documentRow(item, includeLocation) {
      const locked = locks.has("document:" + item.id);
      const details = [KIND_LABELS[item.kind], formatSize(item.size), formatDate(item.created_at)].filter(Boolean);
      const deal = dealMap.get(item.deal_id);
      const client = clientMap.get(effectiveClient(item));
      if (includeLocation && client) details.push(client.name + (deal ? " → " + deal.name : ""));
      const information = el("div", { className: "dd-docs__document-info" }, [
        el("span", { className: "dd-docs__filename", text: item.filename }),
        el("span", { className: "dd-docs__document-meta", text: details.join(" · ") }),
        el("span", { className: "dd-docs__badge dd-docs__badge--" + item.status, text: LABELS[item.status] })
      ]);
      if ((item.status === "error" || item.status === "needs_attention") && item.error_code) {
        information.append(el("p", {
          className: item.status === "error" ? "dd-docs__error-text" : "dd-docs__document-hint",
          text: ERROR_MESSAGES[item.error_code.toUpperCase()] || "Документ сохранён. При необходимости можно уточнить его папку."
        }));
      }
      const actions = el("div", { className: "dd-docs__document-actions" }, [
        button("Оригинал", "original", item.id, { icon: "open", className: "dd-docs__button--small", disabled: locks.has("original:" + item.id) })
      ]);
      if (!PENDING.has(item.status)) actions.append(button("Переместить", "move", item.id, { icon: "move", className: "dd-docs__button--small", disabled: locked }));
      if (canRetry(item)) actions.append(button("Повторить", "retry-document", item.id, { icon: "refresh", className: "dd-docs__button--small", disabled: locked }));
      return el("article", { className: "dd-docs__document" }, [
        el("span", { className: "dd-docs__document-icon" }, [icon("file")]), information, actions
      ]);
    }

    function documentsSection(items, title, includeLocation) {
      const section = el("section", { className: "dd-docs__document-section" });
      if (title) section.append(sectionHeading(title, ""));
      const list = el("div", { className: "dd-docs__document-list" });
      for (const item of items.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))) list.append(documentRow(item, includeLocation));
      section.append(list);
      return section;
    }

    function renderContent() {
      content.replaceChildren();
      if (!loaded) {
        content.append(emptyState(listError ? "Не удалось загрузить документы" : "Загружаем документы…", listError || "Папки появятся здесь."));
        if (listError) content.append(button("Повторить", "refresh", "", { icon: "refresh" }));
        return;
      }
      const pending = pendingDocuments();
      if (pending.length) {
        const section = documentsSection(showAllPending ? pending : pending.slice(0, 4), "Распределяем по папкам · " + pending.length, true);
        section.classList.add("dd-docs__pending-section");
        if (pending.length > 4) section.append(button(showAllPending ? "Свернуть" : "Показать все · " + pending.length, "toggle-pending", "", { className: "dd-docs__button--quiet" }));
        content.append(section);
      }

      if (!view.clientId) {
        content.append(sectionHeading("Клиенты", "Папки создаются автоматически из добавленных документов.", button("Новый клиент", "create-client", "", { icon: "plus", className: "dd-docs__button--small" })));
        if (!data.clients.length) content.append(emptyState("Добавьте первый документ", "Сфотографируйте его или выберите файл. Создадим клиента, сделку и разложим документы по папкам."));
        const grid = el("div", { className: "dd-docs__folders" });
        for (const client of data.clients.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
          const deals = data.deals.filter(item => item.client_id === client.id).length;
          const docs = data.documents.filter(item => effectiveClient(item) === client.id).length;
          grid.append(folderCard(client, "client", "Сделок: " + deals + " · Документов: " + docs + (client.inn ? " · ИНН " + client.inn : "")));
        }
        content.append(grid);
        const unassigned = data.documents.filter(item => !PENDING.has(item.status) && !clientMap.has(effectiveClient(item)));
        if (unassigned.length) content.append(documentsSection(unassigned, "Документы без папки", false));
      } else if (!view.dealId) {
        const client = clientMap.get(view.clientId);
        content.append(sectionHeading(client.name, client.inn ? "ИНН " + client.inn : "Сделки клиента", button("Изменить", "rename-client", client.id, { icon: "edit", className: "dd-docs__button--small" })));
        content.append(sectionHeading("Сделки", "", button("Новая сделка", "create-deal", client.id, { icon: "plus", className: "dd-docs__button--small" })));
        const deals = data.deals.filter(item => item.client_id === client.id);
        if (!deals.length) content.append(emptyState("Здесь появятся сделки", "Добавьте документ — определим сделку автоматически. Папку также можно создать самостоятельно."));
        const grid = el("div", { className: "dd-docs__folders" });
        for (const deal of deals.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
          const count = data.documents.filter(item => item.deal_id === deal.id).length;
          grid.append(folderCard(deal, "deal", "Документов: " + count + (deal.contract_number ? " · № " + deal.contract_number : "")));
        }
        content.append(grid);
        const unassigned = data.documents.filter(item => !PENDING.has(item.status) && effectiveClient(item) === client.id && !dealMap.has(item.deal_id));
        if (unassigned.length) content.append(documentsSection(unassigned, "Документы без сделки", false));
      } else {
        const deal = dealMap.get(view.dealId);
        content.append(sectionHeading(deal.name, deal.contract_number ? "Договор № " + deal.contract_number : "Документы сделки", button("Изменить", "rename-deal", deal.id, { icon: "edit", className: "dd-docs__button--small" })));
        const items = data.documents.filter(item => item.deal_id === deal.id && !PENDING.has(item.status));
        if (items.length) content.append(documentsSection(items, "", false));
        else content.append(emptyState("В этой сделке пока нет готовых документов", "Добавьте файлы или перенесите их из другой папки. Обработка новых документов показана выше."));
      }
    }

    function render() {
      if (destroyed) return;
      updateLiveStatus();
      renderUploads();
      // Polling does not replace an active form or steal keyboard focus.
      if (!editor) {
        renderBreadcrumbs();
        renderContent();
      }
      updateEditorBusy();
    }

    function stopPolling() {
      if (pollTimer !== null) { win.clearTimeout(pollTimer); pollTimer = null; }
    }

    function schedulePolling() {
      stopPolling();
      if (destroyed || activeMutations || !pendingDocuments().length || doc.visibilityState === "hidden") return;
      pollTimer = win.setTimeout(() => { pollTimer = null; void refresh(); }, POLL_MS);
    }

    function reportCompletedUploads() {
      for (const id of completedUploads) {
        const item = documentMap.get(id);
        if (!item || PENDING.has(item.status)) continue;
        if (item.status === "ready" || item.status === "needs_attention") {
          const deal = dealMap.get(item.deal_id);
          const client = deal && clientMap.get(deal.client_id);
          if (deal && client && !editor && (!notice || notice.level !== "error")) notify("Добавлено в «" + client.name + " → " + deal.name + "».", "success", deal.id);
        }
        completedUploads.delete(id);
      }
    }

    function refresh() {
      if (destroyed) return Promise.resolve(null);
      if (activeMutations) { refreshAgain = true; return Promise.resolve(null); }
      if (readPromise) { refreshAgain = true; return readPromise; }
      stopPolling();
      const sequence = ++readSequence;
      const requestEpoch = epoch;
      loading = true;
      render();
      readPromise = Promise.resolve().then(() => api.listWorkspace()).then(result => {
        if (destroyed || sequence !== readSequence || requestEpoch !== epoch || activeMutations) return null;
        data = workspaceRecord(result);
        reindex();
        loaded = true;
        listError = "";
        reportCompletedUploads();
        return data;
      }).catch(error => {
        if (destroyed || sequence !== readSequence || requestEpoch !== epoch) return null;
        listError = safeError(error, "Не удалось обновить список. Проверьте соединение и попробуйте ещё раз.");
        if (loaded && (!notice || notice.level !== "error")) notify(listError, "error");
        return null;
      }).finally(() => {
        readPromise = null;
        if (destroyed) return;
        loading = false;
        render();
        if (refreshAgain && !activeMutations) { refreshAgain = false; void refresh(); }
        else schedulePolling();
      });
      return readPromise;
    }

    async function mutate(lock, operation, onSuccess, editorToken) {
      if (destroyed || locks.has(lock)) return null;
      locks.add(lock);
      activeMutations += 1;
      epoch += 1;
      readSequence += 1;
      stopPolling();
      if (editor && editor.token === editorToken) { editor.busy = true; editor.error = ""; }
      render();
      try {
        const result = await operation();
        if (destroyed) return null;
        epoch += 1;
        onSuccess(result);
        return result;
      } catch (error) {
        if (destroyed) return null;
        const message = safeError(error);
        if (editor && editor.token === editorToken) { editor.error = message; renderEditorError(); }
        else notify(message, "error");
        return null;
      } finally {
        locks.delete(lock);
        activeMutations -= 1;
        epoch += 1;
        if (!destroyed) {
          if (editor && editor.token === editorToken) editor.busy = false;
          render();
          if (!activeMutations) { refreshAgain = false; void refresh(); }
        }
      }
    }

    function chooseFiles(input) {
      const selected = Array.from(input.files || []);
      input.value = "";
      const hints = {};
      if (view.clientId) hints.client_id = view.clientId;
      if (view.dealId) hints.deal_id = view.dealId;
      for (const file of selected) {
        const error = fileError(file);
        uploadRows.push({
          id: String(++uploadNumber), file: error ? null : file, name: file.name || "Документ",
          hints: Object.assign({}, hints), state: error ? "error" : "waiting",
          validationError: Boolean(error), error: error ? ERROR_MESSAGES[error] : ""
        });
      }
      render();
      pumpUploads();
    }

    function pumpUploads() {
      if (destroyed) return;
      while (activeUploads < MAX_UPLOADS) {
        const item = uploadRows.find(row => row.state === "waiting");
        if (!item) break;
        activeUploads += 1;
        item.state = "uploading";
        void uploadOne(item);
      }
      render();
    }

    async function uploadOne(item) {
      activeMutations += 1;
      epoch += 1;
      readSequence += 1;
      stopPolling();
      try {
        const result = await api.uploadFile(item.file, Object.assign({}, item.hints));
        if (destroyed) return;
        const record = documentRecord(result);
        upsert("documents", record);
        completedUploads.add(record.id);
        item.state = "uploaded";
        item.file = null;
        item.error = "";
      } catch (error) {
        if (destroyed) return;
        item.state = "error";
        item.error = safeError(error, "Не удалось загрузить файл. Попробуйте ещё раз.");
      } finally {
        activeUploads -= 1;
        activeMutations -= 1;
        epoch += 1;
        if (!destroyed) {
          uploadRows = uploadRows.filter(row => row.state !== "uploaded");
          pumpUploads();
          if (!activeMutations) { refreshAgain = false; void refresh(); }
        }
      }
    }

    function navigate(clientId, dealId) {
      if (editor && editor.busy) return;
      closeEditor(false);
      const selectedClient = clientMap.has(clientId) ? clientId : "";
      const selectedDeal = dealMap.get(dealId);
      view = { clientId: selectedClient, dealId: selectedDeal && selectedDeal.client_id === selectedClient ? selectedDeal.id : "" };
      render();
    }

    function openEditor(next) {
      if (editor && editor.busy) return;
      editor = Object.assign({ token: ++editorNumber, busy: false, error: "", name: "", inn: "", clientId: "", dealId: "", createMode: "", newName: "", newInn: "" }, next);
      renderEditor();
      render();
      if (typeof editorBox.scrollIntoView === "function") editorBox.scrollIntoView({ block: "nearest", behavior: "auto" });
    }

    function closeEditor(shouldRender) {
      if (editor && editor.busy) return;
      editor = null;
      editorBox.hidden = true;
      editorBox.replaceChildren();
      if (shouldRender !== false) render();
    }

    function inputField(label, name, value, options) {
      const opts = options || {};
      const field = el("input", {
        type: "text", name, id: prefix + name, value: value || "", maxlength: opts.maxLength || "200",
        required: opts.required || false, inputmode: opts.inputMode || undefined, autocomplete: "off"
      });
      return el("label", { className: "dd-docs__field", for: prefix + name }, [el("span", { text: label }), field]);
    }

    function selectField(label, name, items, selected, placeholder) {
      const field = el("select", { name, id: prefix + name });
      field.append(el("option", { value: "", text: placeholder }));
      for (const item of items) field.append(el("option", { value: item.id, text: item.name }));
      field.value = selected || "";
      return el("label", { className: "dd-docs__field", for: prefix + name }, [el("span", { text: label }), field]);
    }

    function renderEditor() {
      editorBox.replaceChildren();
      editorBox.hidden = !editor;
      if (!editor) return;
      const form = el("form", { "data-dd-form": editor.type, "data-editor-token": String(editor.token), novalidate: true });
      const names = { renameClient: "Изменить клиента", renameDeal: "Изменить название сделки", createClient: "Новый клиент", createDeal: "Новая сделка", move: "Переместить документ" };
      form.append(sectionHeading(names[editor.type] || "Папка", editor.type === "move" ? text(documentMap.get(editor.id)?.filename) : ""));
      if (editor.type === "move") {
        const clients = data.clients.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
        const deals = data.deals.filter(item => item.client_id === editor.clientId).sort((a, b) => a.name.localeCompare(b.name, "ru"));
        const fields = el("div", { className: "dd-docs__form-grid" }, [
          selectField("Клиент", "clientId", clients, editor.clientId, "Выберите клиента"),
          selectField("Сделка", "dealId", deals, editor.dealId, editor.clientId ? "Выберите сделку" : "Сначала выберите клиента")
        ]);
        form.append(fields);
        form.append(el("div", { className: "dd-docs__inline-actions" }, [
          button("Новый клиент", "move-create-client", "", { icon: "plus", className: "dd-docs__button--quiet" }),
          button("Новая сделка", "move-create-deal", "", { icon: "plus", className: "dd-docs__button--quiet", disabled: !editor.clientId })
        ]));
        if (editor.createMode) {
          const creation = el("div", { className: "dd-docs__nested-creation" }, [
            inputField(editor.createMode === "client" ? "Название нового клиента" : "Название новой сделки", "newName", editor.newName, { required: true })
          ]);
          if (editor.createMode === "client") creation.append(inputField("ИНН — необязательно", "newInn", editor.newInn, { inputMode: "numeric", maxLength: "24" }));
          creation.append(el("div", { className: "dd-docs__inline-actions" }, [button("Создать папку", "move-save-folder", "", { className: "dd-docs__button--small" }), button("Отмена", "move-cancel-folder", "", { className: "dd-docs__button--quiet" })]));
          form.append(creation);
        }
      } else {
        form.append(inputField(editor.type.endsWith("Client") ? "Название клиента" : "Название сделки", "name", editor.name, { required: true }));
        if (editor.type.endsWith("Client")) form.append(inputField("ИНН — необязательно", "inn", editor.inn, { inputMode: "numeric", maxLength: "24" }));
      }
      form.append(el("p", { className: "dd-docs__form-error", "data-editor-error": true, role: "alert", hidden: !editor.error, text: editor.error }));
      const submit = el("button", { type: "submit", className: "dd-docs__button dd-docs__button--primary", "data-editor-submit": true, text: editor.type === "move" ? "Переместить" : editor.type.startsWith("create") ? "Создать" : "Сохранить" });
      form.append(el("div", { className: "dd-docs__form-actions" }, [submit, button("Отмена", "close-editor", "", { className: "dd-docs__button--quiet" })]));
      editorBox.append(form);
      updateEditorBusy();
      const first = form.querySelector(editor.createMode ? '[name="newName"]' : "input,select");
      if (first && !editor.busy) first.focus({ preventScroll: true });
    }

    function renderEditorError() {
      const target = editorBox.querySelector("[data-editor-error]");
      if (target && editor) { target.textContent = editor.error; target.hidden = !editor.error; }
    }

    function updateEditorBusy() {
      if (!editor) return;
      for (const control of editorBox.querySelectorAll("input,select,button")) control.disabled = editor.busy;
      const createDeal = editorBox.querySelector('[data-dd-action="move-create-deal"]');
      if (createDeal) createDeal.disabled = editor.busy || !editor.clientId;
      const submit = editorBox.querySelector("[data-editor-submit]");
      if (submit && editor.type === "move") {
        const destination = dealMap.get(editor.dealId);
        submit.disabled = editor.busy || !destination || destination.client_id !== editor.clientId || Boolean(editor.createMode);
      }
      editorBox.setAttribute("aria-busy", String(editor.busy));
      renderEditorError();
    }

    function setEditorError(message) {
      if (editor) { editor.error = message; renderEditorError(); }
    }

    function submitEditor() {
      if (!editor || editor.busy) return;
      const current = editor;
      if (current.type === "move" && current.createMode) { createMoveFolder(); return; }
      const name = current.name.trim();
      const inn = current.inn.trim();
      const token = current.token;
      if (current.type !== "move" && !name) { setEditorError("Введите название."); return; }
      const finish = (collection, normalize, message, nextView) => result => {
        const record = normalize(result);
        upsert(collection, record);
        if (editor && editor.token === token) { editor.busy = false; closeEditor(false); }
        if (nextView) view = nextView(record);
        notify(message, "success");
      };
      if (current.type === "renameClient") {
        void mutate("client:" + current.id, () => api.renameClient(current.id, { name, inn, version: current.version }), finish("clients", clientRecord, "Клиент обновлён."), token);
      } else if (current.type === "renameDeal") {
        void mutate("deal:" + current.id, () => api.renameDeal(current.id, { name, version: current.version }), finish("deals", dealRecord, "Название сделки обновлено."), token);
      } else if (current.type === "createClient") {
        void mutate("create-client", () => api.createClient(inn ? { name, inn } : { name }), finish("clients", clientRecord, "Папка клиента создана.", record => ({ clientId: record.id, dealId: "" })), token);
      } else if (current.type === "createDeal") {
        if (!clientMap.has(current.clientId)) { setEditorError("Клиент больше недоступен. Обновите список."); return; }
        void mutate("create-deal", () => api.createDeal({ client_id: current.clientId, name }), finish("deals", dealRecord, "Папка сделки создана.", record => ({ clientId: record.client_id, dealId: record.id })), token);
      } else if (current.type === "move") {
        const destination = dealMap.get(current.dealId);
        if (!destination || destination.client_id !== current.clientId) { setEditorError("Выберите сделку для документа."); return; }
        void mutate("document:" + current.id, () => api.moveDocument(current.id, { deal_id: destination.id, version: current.version }), result => {
          upsert("documents", documentRecord(result));
          if (editor && editor.token === token) { editor.busy = false; closeEditor(false); }
          notify("Документ перемещён в «" + destination.name + "».", "success", destination.id);
        }, token);
      }
    }

    function createMoveFolder() {
      if (!editor || editor.type !== "move" || editor.busy || !editor.createMode) return;
      const current = editor;
      const name = current.newName.trim();
      const inn = current.newInn.trim();
      if (!name) { setEditorError("Введите название новой папки."); return; }
      if (current.createMode === "client") {
        void mutate("create-client", () => api.createClient(inn ? { name, inn } : { name }), result => {
          const record = clientRecord(result);
          upsert("clients", record);
          if (editor && editor.token === current.token) {
            editor.clientId = record.id; editor.dealId = ""; editor.createMode = "deal"; editor.newName = ""; editor.newInn = ""; editor.busy = false;
            renderEditor();
          }
        }, current.token);
      } else {
        if (!clientMap.has(current.clientId)) { setEditorError("Выберите клиента."); return; }
        void mutate("create-deal", () => api.createDeal({ client_id: current.clientId, name }), result => {
          const record = dealRecord(result);
          upsert("deals", record);
          if (editor && editor.token === current.token) {
            editor.dealId = record.id; editor.createMode = ""; editor.newName = ""; editor.newInn = ""; editor.busy = false;
            renderEditor();
          }
        }, current.token);
      }
    }

    function revoke(url) {
      if (urls.delete(url)) win.URL.revokeObjectURL(url);
    }

    async function openOriginal(id) {
      const item = documentMap.get(id);
      if (!item || destroyed || locks.has("original:" + id)) return;
      let popup = null;
      try {
        popup = win.open("about:blank", "_blank");
        if (popup) {
          popup.opener = null;
          popup.document.title = "Оригинал документа";
          popup.document.body.textContent = "Открываем оригинал…";
          waitingWindows.add(popup);
        }
      } catch (_) { popup = null; }
      locks.add("original:" + id);
      render();
      try {
        const blob = await api.openOriginal(id);
        if (destroyed) { if (popup && !popup.closed) popup.close(); return; }
        if (!(blob instanceof win.Blob)) throw { code: "ORIGINAL_UNAVAILABLE" };
        const receivedMime = text(blob.type).toLowerCase().split(";")[0];
        const mime = (!receivedMime || receivedMime === "application/octet-stream") ? item.mime_type.toLowerCase().split(";")[0] : receivedMime;
        if (!MIME_TYPES.has(mime)) throw { code: "ORIGINAL_UNAVAILABLE" };
        const safeBlob = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
        const url = win.URL.createObjectURL(safeBlob);
        urls.add(url);
        if (popup && !popup.closed) {
          popup.location.replace(url);
          waitingWindows.delete(popup);
        } else {
          const anchor = el("a", { href: url, download: item.filename.replace(/[\\/\x00-\x1f]/g, "_"), rel: "noopener" });
          shell.append(anchor); anchor.click(); anchor.remove();
        }
        const timer = win.setTimeout(() => { urlTimers.delete(timer); revoke(url); }, 120000);
        urlTimers.add(timer);
      } catch (error) {
        if (popup && !popup.closed) popup.close();
        if (!destroyed) notify(safeError(error, ERROR_MESSAGES.ORIGINAL_UNAVAILABLE), "error");
      } finally {
        if (popup) waitingWindows.delete(popup);
        locks.delete("original:" + id);
        if (!destroyed) render();
      }
    }

    function handleClick(event) {
      const target = event.target.closest && event.target.closest("[data-dd-action]");
      if (!target || !shell.contains(target) || target.disabled || destroyed) return;
      const action = target.getAttribute("data-dd-action");
      const id = target.getAttribute("data-id") || "";
      if (action === "camera") cameraInput.click();
      else if (action === "files") filesInput.click();
      else if (action === "refresh") void refresh();
      else if (action === "dismiss-notice") { notice = null; renderNotice(); }
      else if (action === "home") navigate("", "");
      else if (action === "back") navigate(view.dealId ? view.clientId : "", "");
      else if (action === "client" && clientMap.has(id)) navigate(id, "");
      else if (action === "deal" && dealMap.has(id)) navigate(dealMap.get(id).client_id, id);
      else if (action === "toggle-pending") { showAllPending = !showAllPending; render(); }
      else if (action === "close-editor") closeEditor();
      else if (action === "rename-client" && clientMap.has(id)) { const item = clientMap.get(id); openEditor({ type: "renameClient", id, name: item.name, inn: item.inn, version: item.version }); }
      else if (action === "rename-deal" && dealMap.has(id)) { const item = dealMap.get(id); openEditor({ type: "renameDeal", id, name: item.name, version: item.version }); }
      else if (action === "create-client") openEditor({ type: "createClient" });
      else if (action === "create-deal" && clientMap.has(id)) openEditor({ type: "createDeal", clientId: id });
      else if (action === "move" && documentMap.has(id)) {
        const item = documentMap.get(id);
        if (!PENDING.has(item.status)) openEditor({ type: "move", id, clientId: effectiveClient(item), dealId: dealMap.has(item.deal_id) ? item.deal_id : "", version: item.version });
      } else if (action === "move-create-client" && editor && !editor.busy) { editor.createMode = "client"; editor.newName = ""; editor.newInn = ""; editor.error = ""; renderEditor(); }
      else if (action === "move-create-deal" && editor && editor.clientId && !editor.busy) { editor.createMode = "deal"; editor.newName = ""; editor.error = ""; renderEditor(); }
      else if (action === "move-cancel-folder" && editor && !editor.busy) { editor.createMode = ""; editor.error = ""; renderEditor(); }
      else if (action === "move-save-folder") createMoveFolder();
      else if (action === "original") void openOriginal(id);
      else if (action === "retry-document" && documentMap.has(id) && canRetry(documentMap.get(id))) {
        void mutate("document:" + id, () => api.retryDocument(id), result => { upsert("documents", documentRecord(result)); completedUploads.add(id); notify("Повторная обработка запущена."); });
      } else if (action === "retry-upload") {
        const item = uploadRows.find(row => row.id === id);
        if (item && item.file && item.state === "error" && !item.validationError) { item.state = "waiting"; item.error = ""; pumpUploads(); }
      } else if (action === "remove-upload") { uploadRows = uploadRows.filter(row => row.id !== id || row.state !== "error"); render(); }
    }

    function handleField(event) {
      if (!editor || editor.busy || !editorBox.contains(event.target)) return;
      const form = event.target.closest("[data-editor-token]");
      if (!form || form.getAttribute("data-editor-token") !== String(editor.token)) return;
      const name = event.target.name;
      if (["name", "inn", "newName", "newInn", "clientId", "dealId"].includes(name)) editor[name] = event.target.value;
      if (event.type === "change" && name === "clientId") {
        editor.dealId = ""; editor.createMode = ""; editor.error = ""; renderEditor();
      } else if (name === "dealId") updateEditorBusy();
    }

    shell.addEventListener("click", handleClick, { signal: controller.signal });
    shell.addEventListener("input", handleField, { signal: controller.signal });
    shell.addEventListener("change", handleField, { signal: controller.signal });
    shell.addEventListener("submit", event => {
      if (event.target.matches("[data-dd-form]")) { event.preventDefault(); submitEditor(); }
    }, { signal: controller.signal });
    cameraInput.addEventListener("change", () => chooseFiles(cameraInput), { signal: controller.signal });
    filesInput.addEventListener("change", () => chooseFiles(filesInput), { signal: controller.signal });
    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState === "hidden") stopPolling();
      else if (pendingDocuments().length) void refresh();
    }, { signal: controller.signal });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      epoch += 1;
      readSequence += 1;
      stopPolling();
      controller.abort();
      for (const timer of urlTimers) win.clearTimeout(timer);
      urlTimers.clear();
      for (const url of Array.from(urls)) revoke(url);
      for (const popup of waitingWindows) { try { if (!popup.closed) popup.close(); } catch (_) { /* already closed */ } }
      waitingWindows.clear();
      // The fixed adapter has no cancellation argument. Accepted server jobs
      // continue; late callbacks are ignored. Files not yet sent are released.
      for (const item of uploadRows) item.file = null;
      uploadRows = [];
      editor = null;
      completedUploads.clear();
      locks.clear();
      shell.remove();
      if (mounted.get(root) === instance) mounted.delete(root);
    }

    const instance = { destroy, refresh };
    mounted.set(root, instance);
    render();
    void refresh();
    return instance;
  }

  global.DalDobroDocuments = Object.freeze({ mount });
})(window);
