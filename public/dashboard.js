const DATA_URL = "/data/gct_workshop_data.json";

const palette = ["#0c7a6d", "#f08b40", "#2f5d89", "#678d3e", "#9f3b4f", "#8552a1", "#2a9db6"];

const elements = {
  datasetMeta: document.getElementById("datasetMeta"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  orgTypeFilter: document.getElementById("orgTypeFilter"),
  kpiOrgCount: document.getElementById("kpiOrgCount"),
  kpiParticipants: document.getElementById("kpiParticipants"),
  kpiCurrent: document.getElementById("kpiCurrent"),
  kpiPlanned: document.getElementById("kpiPlanned"),
  tableMeta: document.getElementById("tableMeta"),
  tableBody: document.getElementById("tableBody"),
  orgTypeChart: document.getElementById("orgTypeChart"),
  roleChart: document.getElementById("roleChart"),
  regionsChart: document.getElementById("regionsChart"),
  supportChart: document.getElementById("supportChart"),
  topicsChart: document.getElementById("topicsChart")
};

const state = {
  dataset: null,
  rows: [],
  columns: null
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isChecked(value) {
  const text = normalize(value);
  return Boolean(text) && text !== "0" && text !== "false" && text !== "ні";
}

function shortLabel(text) {
  const source = String(text || "");
  const tail = source.match(/\(([^()]+)\)\s*$/);
  let out = tail ? tail[1] : source;
  out = out.replace(/\s+/g, " ").trim();
  if (out.includes(" / ")) out = out.split(" / ")[0].trim();
  return out;
}

function findHeader(headers, pattern, excludeParen = false) {
  return (
    headers.find((header) => {
      if (!header.includes(pattern)) return false;
      if (excludeParen && header.includes("(")) return false;
      return true;
    }) || ""
  );
}

function optionColumns(headers, prefix) {
  const items = headers.filter((header) => header.startsWith(prefix) && header.includes("("));
  const seen = new Map();
  return items.map((header) => {
    const base = shortLabel(header);
    const idx = (seen.get(base) || 0) + 1;
    seen.set(base, idx);
    const label = idx === 1 ? base : `${base} (${idx})`;
    return { header, label };
  });
}

function initColumns(headers) {
  const statusPrefix =
    "Чи впроваджує ваша організація групові грошові перекази? / Does your organisation implement group cash transfers? (";

  const statusOptions = optionColumns(headers, statusPrefix);
  const statusByKey = {
    current: statusOptions.find((item) => item.header.includes("наразі впроваджує"))?.header || "",
    previous: statusOptions.find((item) => item.header.includes("впроваджувала раніше"))?.header || "",
    planned: statusOptions.find((item) => item.header.includes("планує впровадження"))?.header || "",
    none: statusOptions.find((item) => item.header.includes("досвіду немає"))?.header || ""
  };

  return {
    orgName: findHeader(headers, "Назва організації / Name of organisation"),
    orgTypeMain: findHeader(headers, "Тип організації / Type of organisation", true),
    roleMain: findHeader(headers, "Роль у GCT / Role in GCT", true),
    statusMain: findHeader(
      headers,
      "Чи впроваджує ваша організація групові грошові перекази? / Does your organisation implement group cash transfers?",
      true
    ),
    language: findHeader(headers, "Бажана мова комунікації / Preferred language for communication"),
    participants: findHeader(
      headers,
      "Будь ласка, вкажіть запропонованих учасників від вашої організації / Please indicate the proposed participants from your organisation."
    ),
    orgTypeOptions: optionColumns(headers, "Тип організації / Type of organisation ("),
    roleOptions: optionColumns(headers, "Роль у GCT / Role in GCT ("),
    regionOptions: optionColumns(
      headers,
      "Географія діяльності (області України) / Geography of activities (regions of Ukraine) ("
    ),
    supportOptions: optionColumns(
      headers,
      "Які види підтримки могли б посилити вашу роботу за напрямом групових грошових переказів? / What types of support could strengthen your work in the area of group cash transfers? ("
    ),
    topicOptions: optionColumns(
      headers,
      "На яких пріоритетних темах, на вашу думку, має бути зосереджений воркшоп? / What priority topics do you think the workshop should focus on? ("
    ),
    statusByKey
  };
}

function countByOptions(rows, options) {
  const counts = options.map((opt) => ({ ...opt, value: 0 }));
  for (const row of rows) {
    for (const item of counts) {
      if (isChecked(row[item.header])) item.value += 1;
    }
  }
  return counts.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
}

function rowMatchesStatus(row, key) {
  if (key === "all") return true;
  const header = state.columns.statusByKey[key];
  if (header && isChecked(row[header])) return true;
  const text = normalize(row[state.columns.statusMain]);
  if (key === "current") return text.includes("наразі впроваджує");
  if (key === "previous") return text.includes("впроваджувала раніше");
  if (key === "planned") return text.includes("планує впровадження");
  if (key === "none") return text.includes("досвіду немає");
  return true;
}

function rowMatchesOrgType(row, wanted) {
  if (wanted === "all") return true;
  const option = state.columns.orgTypeOptions.find((item) => item.label === wanted);
  if (option && isChecked(row[option.header])) return true;
  const text = normalize(row[state.columns.orgTypeMain]);
  return text.includes(normalize(wanted));
}

function parseParticipants(value) {
  const raw = String(value || "");
  const match = raw.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderKpis(rows) {
  const currentRows = rows.filter((row) => rowMatchesStatus(row, "current")).length;
  const plannedRows = rows.filter((row) => rowMatchesStatus(row, "planned")).length;
  const participants = rows.reduce((sum, row) => sum + parseParticipants(row[state.columns.participants]), 0);

  elements.kpiOrgCount.textContent = String(rows.length);
  elements.kpiParticipants.textContent = String(participants);
  elements.kpiCurrent.textContent = String(currentRows);
  elements.kpiPlanned.textContent = String(plannedRows);
}

function renderDonut(host, items) {
  if (!items.length) {
    host.innerHTML = `<p class="empty">Немає даних для відображення.</p>`;
    return;
  }

  const top = items.slice(0, 7);
  const total = top.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  const gradients = [];
  const legends = [];

  top.forEach((item, index) => {
    const part = total ? (item.value / total) * 100 : 0;
    const end = start + part;
    const color = palette[index % palette.length];
    gradients.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    legends.push(
      `<li>
        <span class="legend-main"><span class="dot" style="background:${color}"></span><span class="label">${escapeHtml(item.label)}</span></span>
        <span class="value">${item.value}</span>
      </li>`
    );
    start = end;
  });

  host.innerHTML = `
    <div class="donut" style="background: conic-gradient(${gradients.join(", ")});"></div>
    <ul class="legend">${legends.join("")}</ul>
  `;
}

function renderBars(host, items) {
  if (!items.length) {
    host.innerHTML = `<p class="empty">Немає даних для відображення.</p>`;
    return;
  }

  const top = items.slice(0, 12);
  const max = Math.max(...top.map((item) => item.value), 1);
  host.innerHTML = top
    .map((item, index) => {
      const width = (item.value / max) * 100;
      const color = palette[index % palette.length];
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(item.label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(2)}%; background:${color};"></div></div>
          <div class="bar-value">${item.value}</div>
        </div>
      `;
    })
    .join("");
}

function cellValue(row, mainHeader, options) {
  const fromMain = String(row[mainHeader] || "").trim();
  if (fromMain) return fromMain;
  const picked = options.filter((item) => isChecked(row[item.header])).map((item) => item.label);
  return picked.join(", ");
}

function renderTable(rows) {
  elements.tableMeta.textContent = `${rows.length} рядків`;

  if (!rows.length) {
    elements.tableBody.innerHTML = `<tr><td colspan="5" class="empty">За обраними фільтрами записів немає.</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = rows
    .map((row) => {
      const org = row[state.columns.orgName] || "—";
      const orgType = cellValue(row, state.columns.orgTypeMain, state.columns.orgTypeOptions) || "—";
      const role = cellValue(row, state.columns.roleMain, state.columns.roleOptions) || "—";
      const status = row[state.columns.statusMain] || "—";
      const language = row[state.columns.language] || "—";
      return `
        <tr>
          <td>${escapeHtml(org)}</td>
          <td>${escapeHtml(orgType)}</td>
          <td>${escapeHtml(role)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(language)}</td>
        </tr>
      `;
    })
    .join("");
}

function applyFilters() {
  const query = normalize(elements.searchInput.value);
  const status = elements.statusFilter.value;
  const orgType = elements.orgTypeFilter.value;

  const filtered = state.rows.filter((row) => {
    const org = normalize(row[state.columns.orgName]);
    const type = normalize(row[state.columns.orgTypeMain]);
    const role = normalize(row[state.columns.roleMain]);
    const textMatch = !query || org.includes(query) || type.includes(query) || role.includes(query);
    return textMatch && rowMatchesStatus(row, status) && rowMatchesOrgType(row, orgType);
  });

  renderKpis(filtered);
  renderDonut(elements.orgTypeChart, countByOptions(filtered, state.columns.orgTypeOptions));
  renderDonut(elements.roleChart, countByOptions(filtered, state.columns.roleOptions));
  renderBars(elements.regionsChart, countByOptions(filtered, state.columns.regionOptions));
  renderBars(elements.supportChart, countByOptions(filtered, state.columns.supportOptions));
  renderBars(elements.topicsChart, countByOptions(filtered, state.columns.topicOptions));
  renderTable(filtered);
}

function fillOrgTypeFilter() {
  const counts = countByOptions(state.rows, state.columns.orgTypeOptions);
  const sorted = [...counts].sort((a, b) => a.label.localeCompare(b.label, "uk"));
  const options = ['<option value="all">Усі типи</option>'];
  for (const item of sorted) {
    options.push(`<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)} (${item.value})</option>`);
  }
  elements.orgTypeFilter.innerHTML = options.join("");
}

function bindControls() {
  elements.searchInput.addEventListener("input", applyFilters);
  elements.statusFilter.addEventListener("change", applyFilters);
  elements.orgTypeFilter.addEventListener("change", applyFilters);
}

function renderMeta(data) {
  const date = new Date(data.generatedAt);
  const formatted = Number.isNaN(date.getTime())
    ? data.generatedAt
    : date.toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
  elements.datasetMeta.textContent = `Анкет: ${data.rowCount}. Лист: ${data.sheetName}. Оновлено: ${formatted}.`;
}

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Failed to load dataset (${response.status})`);
    state.dataset = await response.json();
    state.rows = Array.isArray(state.dataset.rows) ? state.dataset.rows : [];
    state.columns = initColumns(state.dataset.headers || []);

    renderMeta(state.dataset);
    fillOrgTypeFilter();
    bindControls();
    applyFilters();
  } catch (error) {
    console.error(error);
    elements.datasetMeta.textContent =
      "Не вдалося завантажити дані. Перевірте, що файл public/data/gct_workshop_data.json існує.";
  }
}

init();
