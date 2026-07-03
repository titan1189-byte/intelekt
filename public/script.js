const nodes = {
  sheetTitle: document.getElementById("sheet-title"),
  syncStatus: document.getElementById("sync-status"),
  authLink: document.getElementById("auth-link"),
  reportButton: document.getElementById("report-button"),
  accessPanel: document.getElementById("access-panel"),
  searchInput: document.getElementById("search-input"),
  refreshButton: document.getElementById("refresh-button"),
  sheetTabs: document.getElementById("sheet-tabs"),
  statusTabs: document.getElementById("status-tabs"),
  resultCount: document.getElementById("result-count"),
  itemsBody: document.getElementById("items-body"),
  emptyState: document.getElementById("empty-state")
};

const state = {
  spreadsheetTitle: "",
  sheets: [],
  activeSheetId: new URLSearchParams(window.location.search).get("sheetId") || "",
  items: [],
  statuses: [],
  moveTargets: [],
  accessInfo: null,
  activeStatus: "all",
  query: "",
  loading: false,
  reporting: false,
  collapsedSections: new Set()
};

const statusOrder = ["stock", "repair", "damaged", "lost"];
const editableDetailStatuses = new Set(["repair", "damaged"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function statusMeta(key) {
  return state.statuses.find((status) => status.key === key) || { key, label: key };
}

function moveTargetMeta(value) {
  return state.moveTargets.find((target) => target.key === value || target.sheetValue === value || target.label === value) || null;
}

function setSync(message, isError = false) {
  nodes.syncStatus.textContent = message;
  nodes.syncStatus.dataset.error = isError ? "true" : "false";
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`API повернув не JSON (${response.status}). ${preview || "Порожня відповідь"}`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`API повернув некоректний JSON (${response.status}).`);
  }
}

function setActiveSheet(sheetId, shouldPushUrl = true) {
  state.activeSheetId = String(sheetId ?? "");
  state.activeStatus = "all";
  state.query = "";
  state.collapsedSections.clear();
  nodes.searchInput.value = "";

  if (shouldPushUrl) {
    const url = new URL(window.location.href);
    if (state.activeSheetId) {
      url.searchParams.set("sheetId", state.activeSheetId);
    } else {
      url.searchParams.delete("sheetId");
    }
    window.history.pushState({}, "", url);
  }
}

function countsByStatus() {
  return state.items.reduce(
    (counts, item) => {
      counts.all += 1;
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    },
    { all: 0 }
  );
}

function filteredItems() {
  const query = normalize(state.query);

  return state.items
    .filter((item) => state.activeStatus === "all" || item.status === state.activeStatus)
    .filter((item) => {
      if (!query) return true;
      return normalize([
        item.displayNumber,
        item.name,
        item.serial,
        item.group,
        item.statusRaw,
        item.damage,
        item.circumstances,
        item.repairDate
      ].join(" ")).includes(query);
    })
    .sort((left, right) => {
      if (state.activeStatus === "all") {
        const diff = statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status);
        if (diff !== 0) return diff;
      }
      return left.rowNumber - right.rowNumber;
    });
}

function renderSheetTabs() {
  nodes.sheetTabs.innerHTML = state.sheets
    .map((sheet) => `
      <button class="sheet-tab" data-sheet-id="${escapeHtml(sheet.id)}" data-active="${String(sheet.id) === String(state.activeSheetId)}" type="button">
        <span>${escapeHtml(sheet.title)}</span>
      </button>
    `)
    .join("");
}

function renderStatusTabs() {
  const counts = countsByStatus();
  const tabs = [{ key: "all", label: "Усі" }, ...state.statuses];

  nodes.statusTabs.innerHTML = tabs
    .map((tab) => `
      <button class="status-tab tone-${tab.key}" data-status="${escapeHtml(tab.key)}" data-active="${state.activeStatus === tab.key}" type="button">
        <span>${escapeHtml(tab.label)}</span>
        <strong>${counts[tab.key] || 0}</strong>
      </button>
    `)
    .join("");
}

function renderAccessPanel() {
  const info = state.accessInfo;
  if (!info || !info.user) {
    nodes.accessPanel.hidden = true;
    nodes.accessPanel.innerHTML = "";
    return;
  }

  const protectedCount = (info.visibleSheets || []).reduce((count, sheet) => {
    return count + (sheet.protectedRanges || []).length;
  }, 0);
  const googleHiddenCount = (info.hiddenSheets || []).filter((sheet) => sheet.reason === "google_protected").length;
  const appAccessText = info.appAccess?.configured
    ? `Дозволено аркушів: ${(info.visibleSheets || []).length}`
    : "Обмеження аркушів в апці не налаштовані";
  const hiddenText = info.hiddenSheetsCount
    ? `Приховано аркушів: ${info.hiddenSheetsCount}`
    : "Прихованих аркушів немає";

  nodes.accessPanel.hidden = false;
  nodes.accessPanel.innerHTML = `
    <div class="access-summary">
      <div>
        <span>Google акаунт</span>
        <strong>${escapeHtml(info.user.email || info.user.name)}</strong>
      </div>
    </div>
  `;
}

function statusSelect(item) {
  const targets = state.moveTargets.length
    ? state.moveTargets
    : state.statuses.map((status) => ({
      key: status.key,
      label: status.label,
      sheetValue: status.sheetValue,
      statusKey: status.key
    }));

  return `
    <select class="status-select tone-${item.status}" data-row="${item.rowNumber}">
      ${targets
        .map((target) => `
          <option value="${escapeHtml(target.sheetValue)}" ${normalize(target.sheetValue) === normalize(item.statusRaw) ? "selected" : ""}>
            ${escapeHtml(target.label)}
          </option>
        `)
        .join("")}
    </select>
  `;
}

function sectionTargets() {
  if (state.moveTargets.length) return state.moveTargets;

  return state.statuses.map((status) => ({
    key: status.key,
    label: status.label,
    sheetValue: status.sheetValue,
    statusKey: status.key,
    isMajor: true
  }));
}

function sectionMatchesItem(section, item) {
  const sectionValue = normalize(section.sheetValue || section.label);
  const isFallbackMajorSection = !state.moveTargets.length && section.isMajor;

  return normalize(item.group) === sectionValue
    || normalize(item.statusRaw) === sectionValue
    || (isFallbackMajorSection && item.status === section.statusKey);
}

function sectionKey(section) {
  return section.key || section.sheetValue || section.label || "section";
}

function editableTextArea(item, field, label) {
  return `
    <textarea class="editable-field" data-row="${item.rowNumber}" data-field="${field}" aria-label="${escapeHtml(label)}">${escapeHtml(item[field])}</textarea>
  `;
}

function resizeEditableTextAreas(root = document) {
  root.querySelectorAll("textarea.editable-field").forEach((field) => {
    field.style.height = "auto";
    field.style.height = `${Math.max(field.scrollHeight, 58)}px`;
  });
}

function editableInput(item, field, label) {
  return `
    <input class="editable-field single-line" data-row="${item.rowNumber}" data-field="${field}" aria-label="${escapeHtml(label)}" value="${escapeHtml(item[field])}">
  `;
}

function renderEditableDetailCells(item) {
  return `
      <td class="text-cell">${editableTextArea(item, "damage", "Пошкодження / примітка")}</td>
      <td class="text-cell">${editableTextArea(item, "circumstances", "Обставини")}</td>
      <td>${editableInput(item, "repairDate", "Вихід з ремонту")}</td>
  `;
}

function renderItemRow(item, showEditableDetails) {
  return `
    <tr class="row-${item.status}" data-row="${item.rowNumber}">
      <td class="number-cell">
        <strong>${escapeHtml(item.displayNumber || item.rowNumber)}</strong>
        <span>${escapeHtml(item.group)}</span>
      </td>
      <td class="name-cell">${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.serial)}</td>
      <td class="quantity-cell">${escapeHtml([item.quantity, item.unit].filter(Boolean).join(" "))}</td>
      <td>${statusSelect(item)}</td>
      ${showEditableDetails ? renderEditableDetailCells(item) : ""}
    </tr>
  `;
}

function renderMobileEditableDetails(item) {
  return `
        <div>
          <dt>Пошкодження / примітка</dt>
          <dd>${editableTextArea(item, "damage", "Пошкодження / примітка")}</dd>
        </div>
        <div>
          <dt>Обставини</dt>
          <dd>${editableTextArea(item, "circumstances", "Обставини")}</dd>
        </div>
        <div>
          <dt>Вихід з ремонту</dt>
          <dd>${editableInput(item, "repairDate", "Вихід з ремонту")}</dd>
        </div>
  `;
}

function renderMobileItemCard(item, showEditableDetails) {
  return `
    <article class="inventory-item-card row-${item.status}" data-row="${item.rowNumber}">
      <div class="mobile-card-top">
        <div>
          <span class="mobile-number">№ ${escapeHtml(item.displayNumber || item.rowNumber)}</span>
          <h3>${escapeHtml(item.name)}</h3>
        </div>
        <span class="mobile-qty">${escapeHtml([item.quantity, item.unit].filter(Boolean).join(" "))}</span>
      </div>
      <dl class="mobile-fields">
        <div>
          <dt>Заводський номер</dt>
          <dd>${escapeHtml(item.serial || "—")}</dd>
        </div>
        <div>
          <dt>Група</dt>
          <dd>${escapeHtml(item.group || "—")}</dd>
        </div>
        <div>
          <dt>Статус</dt>
          <dd>${statusSelect(item)}</dd>
        </div>
        ${showEditableDetails ? renderMobileEditableDetails(item) : ""}
      </dl>
    </article>
  `;
}

function groupItemsByGroup(items) {
  const groups = [];
  const indexByName = new Map();

  items.forEach((item) => {
    const groupName = item.group || "Без групи";

    if (!indexByName.has(groupName)) {
      indexByName.set(groupName, groups.length);
      groups.push({
        name: groupName,
        items: []
      });
    }

    groups[indexByName.get(groupName)].items.push(item);
  });

  return groups;
}

function renderDesktopGroup(group, showEditableDetails) {
  return `
    <tr class="subgroup-row">
      <td colspan="${showEditableDetails ? 8 : 5}">
        <div class="subgroup-title">
          <span>${escapeHtml(group.name)}</span>
          <strong>${group.items.length}</strong>
        </div>
      </td>
    </tr>
    ${group.items.map((item) => renderItemRow(item, showEditableDetails)).join("")}
  `;
}

function renderMobileGroup(group, showEditableDetails) {
  return `
    <section class="mobile-subgroup">
      <header class="mobile-subgroup-head">
        <span>${escapeHtml(group.name)}</span>
        <strong>${group.items.length}</strong>
      </header>
      <div class="mobile-subgroup-items">
        ${group.items.map((item) => renderMobileItemCard(item, showEditableDetails)).join("")}
      </div>
    </section>
  `;
}

function renderSectionBlock(section, items) {
  const status = statusMeta(section.statusKey || section.key);
  const sectionTitle = section.label || section.sheetValue || status.label;
  const subtitle = section.isMajor ? "" : status.label;
  const blockKey = sectionKey(section);
  const isCollapsed = state.collapsedSections.has(blockKey);
  const showEditableDetails = editableDetailStatuses.has(status.key);
  const tableColumnCount = showEditableDetails ? 8 : 5;
  const detailHeaders = showEditableDetails
    ? `
              <th>Пошкодження / примітка</th>
              <th>Обставини</th>
              <th>Вихід з ремонту</th>
    `
    : "";

  const tableRows = items.length
    ? items.map((item) => renderItemRow(item, showEditableDetails)).join("")
    : `<tr class="status-empty-row"><td colspan="${tableColumnCount}">Немає записів у цьому блоці.</td></tr>`;

  const mobileCards = items.length
    ? items.map((item) => renderMobileItemCard(item, showEditableDetails)).join("")
    : `<div class="status-empty-card">Немає записів у цьому блоці.</div>`;

  return `
    <section class="status-section tone-${status.key}" data-section-key="${escapeHtml(blockKey)}" data-collapsed="${isCollapsed}">
      <header class="status-section-head">
        <div class="status-section-title">
          <span>${escapeHtml(sectionTitle)}</span>
          ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
        </div>
        <div class="status-section-actions">
          <strong>${items.length}</strong>
          <button class="collapse-toggle" data-section-key="${escapeHtml(blockKey)}" type="button" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? "Розгорнути блок" : "Згорнути блок"}">
            <span aria-hidden="true">${isCollapsed ? "+" : "-"}</span>
          </button>
        </div>
      </header>
      <div class="status-section-table">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Назва майна</th>
              <th>Заводський номер</th>
              <th>К-сть</th>
              <th>Статус</th>
              ${detailHeaders}
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="status-section-mobile">${mobileCards}</div>
    </section>
  `;
}

function renderRows() {
  const items = filteredItems();
  nodes.emptyState.hidden = items.length > 0;
  nodes.resultCount.textContent = `${items.length} ${items.length === 1 ? "запис" : "записів"}`;

  const sections = sectionTargets();
  const visibleSections = state.activeStatus === "all"
    ? sections
    : sections.filter((section) => section.statusKey === state.activeStatus || section.key === state.activeStatus);

  const knownItems = new Set();
  const renderedSections = visibleSections
    .map((section) => {
      const sectionItems = items.filter((item) => sectionMatchesItem(section, item));
      sectionItems.forEach((item) => knownItems.add(item.rowNumber));
      return renderSectionBlock(section, sectionItems);
    });

  const fallbackItems = items.filter((item) => !knownItems.has(item.rowNumber));
  if (fallbackItems.length) {
    renderedSections.push(renderSectionBlock({
      key: "unmatched",
      label: "Без розділу",
      sheetValue: "",
      statusKey: fallbackItems[0].status,
      isMajor: true
    }, fallbackItems));
  }

  nodes.itemsBody.innerHTML = renderedSections
    .join("");
  resizeEditableTextAreas(nodes.itemsBody);
}

function render() {
  renderSheetTabs();
  renderStatusTabs();
  renderAccessPanel();
  renderRows();
}

function handleAuthRequired(payload) {
  nodes.authLink.href = payload.authUrl;
  nodes.authLink.hidden = false;
  setSync(payload.error || "Потрібна авторизація Google.", true);
}

async function loadItems(allowSheetFallback = true) {
  if (state.loading) return;
  state.loading = true;
  nodes.refreshButton.disabled = true;
  nodes.reportButton.disabled = true;
  setSync("Оновлення даних...");

  try {
    const params = new URLSearchParams();
    if (state.activeSheetId) params.set("sheetId", state.activeSheetId);

    const response = await fetch(`/api/items?${params.toString()}&t=${Date.now()}`, { cache: "no-store" });
    const payload = await readJsonResponse(response);

    if (response.status === 401 && payload.authUrl) {
      handleAuthRequired(payload);
      return;
    }

    if (response.status === 403 && payload.code === "SHEET_ACCESS_DENIED" && state.activeSheetId && allowSheetFallback) {
      setActiveSheet("");
      state.loading = false;
      nodes.refreshButton.disabled = false;
      nodes.reportButton.disabled = false;
      setSync("Поточний аркуш недоступний. Відкриваємо доступний аркуш...");
      await loadItems(false);
      return;
    }

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    nodes.authLink.hidden = true;
    state.spreadsheetTitle = payload.spreadsheetTitle || "Google таблиця";
    state.sheets = payload.sheets || [];
    state.activeSheetId = String(payload.sheetId ?? state.activeSheetId ?? "");
    state.items = payload.items || [];
    state.statuses = payload.statuses || [];
    state.moveTargets = payload.moveTargets || [];
    nodes.sheetTitle.textContent = `${state.spreadsheetTitle} / ${payload.sheetTitle || "Аркуш"}`;

    await loadAccessInfo();
    render();
    setSync(`Синхронізовано ${new Date(payload.updatedAt).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`);
  } catch (error) {
    console.error(error);
    setSync(error.message || "Не вдалося завантажити таблицю.", true);
  } finally {
    state.loading = false;
    nodes.refreshButton.disabled = false;
    nodes.reportButton.disabled = state.reporting;
  }
}

async function loadAccessInfo() {
  try {
    const response = await fetch(`/api/access-info?t=${Date.now()}`, { cache: "no-store" });
    const payload = await readJsonResponse(response);

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.accessInfo = payload;
  } catch (error) {
    console.warn(error);
    state.accessInfo = null;
  }
}

async function changeStatus(rowNumber, nextStatus, selectNode) {
  const item = state.items.find((entry) => entry.rowNumber === rowNumber);
  if (!item) return;
  const target = moveTargetMeta(nextStatus);

  const previous = {
    status: item.status,
    statusLabel: item.statusLabel,
    statusRaw: item.statusRaw
  };

  item.status = target ? target.statusKey : nextStatus;
  item.statusLabel = statusMeta(item.status).label;
  item.statusRaw = target ? target.sheetValue : nextStatus;
  render();
  setSync(`Запис у рядок ${rowNumber}...`);

  try {
    const response = await fetch("/api/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: state.activeSheetId,
        rowNumber,
        status: nextStatus
      })
    });
    const payload = await readJsonResponse(response);

    if (response.status === 401 && payload.authUrl) {
      handleAuthRequired(payload);
      throw new Error(payload.error || "Потрібна авторизація Google.");
    }

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    item.status = payload.status;
    item.statusLabel = payload.statusLabel;
    item.statusRaw = payload.statusRaw;
    await loadItems();
    setSync(payload.moved
      ? `Перенесено: ${payload.sheetTitle}, рядок ${payload.newRowNumber}`
      : `Статус оновлено: ${payload.sheetTitle}, рядок ${rowNumber}`);
  } catch (error) {
    item.status = previous.status;
    item.statusLabel = previous.statusLabel;
    item.statusRaw = previous.statusRaw;
    render();
    if (selectNode) selectNode.value = previous.status;
    setSync(error.message || "Не вдалося змінити статус.", true);
  }
}

async function changeEditableField(rowNumber, field, nextValue, inputNode) {
  const item = state.items.find((entry) => entry.rowNumber === rowNumber);
  if (!item || !(field in item)) return;

  const previousValue = item[field] || "";
  if (nextValue === previousValue) return;

  item[field] = nextValue;
  setSync(`Запис у рядок ${rowNumber}...`);

  try {
    const response = await fetch("/api/fields", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: state.activeSheetId,
        rowNumber,
        fields: {
          [field]: nextValue
        }
      })
    });
    const payload = await readJsonResponse(response);

    if (response.status === 401 && payload.authUrl) {
      handleAuthRequired(payload);
      throw new Error(payload.error || "Потрібна авторизація Google.");
    }

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    Object.assign(item, payload.fields || {});
    setSync(`Поле оновлено: ${payload.sheetTitle}, рядок ${rowNumber}`);
  } catch (error) {
    item[field] = previousValue;
    if (inputNode) inputNode.value = previousValue;
    setSync(error.message || "Не вдалося оновити поле.", true);
  }
}

async function sendReport() {
  if (state.reporting || state.loading) return;
  state.reporting = true;
  nodes.reportButton.disabled = true;
  setSync("Формування звіту для WhatsApp...");

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: state.activeSheetId
      })
    });
    const payload = await readJsonResponse(response);

    if (response.status === 401 && payload.authUrl) {
      handleAuthRequired(payload);
      return;
    }

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    if (payload.whatsappUrl) {
      window.open(payload.whatsappUrl, "_blank", "noopener,noreferrer");
    }

    setSync(payload.whatsappUrl
      ? `Звіт сформовано: ${payload.sheetTitle}`
      : `Apps Script виконано: ${payload.functionName}`);
  } catch (error) {
    console.error(error);
    setSync(error.message || "Не вдалося сформувати звіт.", true);
  } finally {
    state.reporting = false;
    nodes.reportButton.disabled = state.loading;
  }
}

nodes.sheetTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sheet-id]");
  if (!button) return;
  setActiveSheet(button.dataset.sheetId);
  loadItems();
});

nodes.statusTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  state.activeStatus = button.dataset.status;
  render();
});

nodes.itemsBody.addEventListener("change", (event) => {
  const select = event.target.closest(".status-select");
  if (select) {
    changeStatus(Number(select.dataset.row), select.value, select);
    return;
  }

  const fieldNode = event.target.closest(".editable-field");
  if (!fieldNode) return;
  changeEditableField(Number(fieldNode.dataset.row), fieldNode.dataset.field, fieldNode.value, fieldNode);
});

nodes.itemsBody.addEventListener("input", (event) => {
  const fieldNode = event.target.closest("textarea.editable-field");
  if (fieldNode) resizeEditableTextAreas(fieldNode.parentElement || document);
});

nodes.itemsBody.addEventListener("click", (event) => {
  const toggle = event.target.closest(".collapse-toggle");
  if (!toggle) return;

  const key = toggle.dataset.sectionKey;
  if (!key) return;

  if (state.collapsedSections.has(key)) {
    state.collapsedSections.delete(key);
  } else {
    state.collapsedSections.add(key);
  }

  renderRows();
});

nodes.itemsBody.addEventListener("keydown", (event) => {
  const fieldNode = event.target.closest(".editable-field");
  if (!fieldNode || event.key !== "Enter" || event.shiftKey || fieldNode.tagName === "TEXTAREA") return;
  fieldNode.blur();
});

nodes.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderRows();
});

nodes.refreshButton.addEventListener("click", loadItems);
nodes.reportButton.addEventListener("click", sendReport);

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  setActiveSheet(params.get("sheetId") || "", false);
  loadItems();
});

loadItems();
setInterval(loadItems, 30000);
