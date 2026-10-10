import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import { listenAllOrders, listenOrdersSince, assignOrder, listenUnassignedOrders } from "./orders.js";
import { getIsporucioci } from "./users.js";
import { isLate } from "./dash-logic.js";
import { formatDate, escapeHtml, badgeClassForStatus, statusLabel, ROLES, roleLabel, debounce } from "./utils.js";

await loadLang();

let allOrders = [];
let chartOrders = []; // narudžbine iz poslednjih 14 dana (poseban upit — tačne brojke i kad ih ima više od 200)
let activeFilter = null; // null (bez filtera) | "active" | "late" | "in_purchase" | "finished_today"
let searchTerm = "";

// Definicije filtera — ISTA logika koja se koristi i za brojanje na karticama,
// da broj na kartici uvek odgovara broju redova kad se ta kartica filtrira.
const FILTERS = {
  active: { labelKey: "active_orders", predicate: (o) => !["zatvorena", "odbijena"].includes(o.status) },
  late: {
    labelKey: "late",
    predicate: (o) => isLate(o, Date.now()), // isto pravilo kao na tablama naručioca/isporučioca (hitno 2h, standardno 24h od dodele)
  },
  in_purchase: { labelKey: "in_purchase", predicate: (o) => o.status === "u_nabavci" },
  finished_today: {
    labelKey: "finished_today",
    predicate: (o) => o.status === "zatvorena" && (o.closedAt || o.updatedAt)?.toDate?.().toDateString() === new Date().toDateString(),
  },
};

requireAuth([ROLES.ADMIN], (user, profile) => {
  renderNav({ companyId: profile.companyId, uid: user.uid, profile });
  document.getElementById("company-name-eyebrow").textContent = roleLabel("admin");

  listenAllOrders(profile.companyId, (orders) => {
    allOrders = orders;
    renderStats(orders);
    renderMetrics(orders);
    renderFilterChip();
    renderOrdersTable(applyFilters(orders));
  });

  const chartSince = new Date();
  chartSince.setDate(chartSince.getDate() - 13);
  chartSince.setHours(0, 0, 0, 0);
  listenOrdersSince(profile.companyId, chartSince, (orders) => {
    chartOrders = orders;
    renderChart(chartOrders);
  }, (err) => console.error("Grafikon narudžbina:", err));

  // Kašnjenje zavisi od vremena — preračunaj brojke svakog minuta (bez čitanja iz baze)
  setInterval(() => {
    if (document.hidden || !allOrders.length) return;
    renderStats(allOrders);
    renderChart(chartOrders); // pomera prozor od 14 dana posle ponoći
    renderOrdersTable(applyFilters(allOrders));
  }, 60000);
});

document.getElementById("order-search").addEventListener("input", debounce((e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderOrdersTable(applyFilters(allOrders));
}, 250));

// Kombinuje aktivni filter sa statističke kartice i tekst pretrage po broju narudžbine
function applyFilters(orders) {
  let result = activeFilter ? orders.filter(FILTERS[activeFilter].predicate) : orders;
  if (searchTerm) result = result.filter((o) => o.orderNumber.toLowerCase().includes(searchTerm));
  return result;
}

function selectFilter(key) {
  activeFilter = activeFilter === key ? null : key; // drugi klik na istu karticu ukida filter
  renderStats(allOrders);
  renderFilterChip();
  renderOrdersTable(applyFilters(allOrders));
}

function renderFilterChip() {
  const host = document.getElementById("filter-chip");
  if (!activeFilter) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <span class="muted" style="font-size:13px;">${t("showing_filter_label")}: <strong>${t(FILTERS[activeFilter].labelKey)}</strong></span>
    <button type="button" class="btn btn-sm btn-ghost" id="reset-filter-btn">${t("show_all_orders_btn")}</button>
  `;
  document.getElementById("reset-filter-btn").addEventListener("click", () => selectFilter(activeFilter));
}

function renderStats(orders) {
  const active = orders.filter((o) => !["zatvorena", "odbijena"].includes(o.status)).length;
  const inPurchase = orders.filter((o) => o.status === "u_nabavci").length;
  const today = new Date().toDateString();
  const finishedToday = orders.filter((o) => o.status === "zatvorena" && (o.closedAt || o.updatedAt)?.toDate?.().toDateString() === today).length;
  const late = orders.filter((o) => isLate(o, Date.now())).length;

  const cardCls = (key) => `stat-card${activeFilter === key ? " active" : ""}`;
  document.getElementById("stat-cards").innerHTML = `
    <div class="${cardCls("active")}" data-filter="active" role="button" tabindex="0"><div class="stat-label" data-i18n="active_orders">Aktivne narudžbine</div><div class="stat-value">${active}</div></div>
    <div class="${cardCls("late")} red" data-filter="late" role="button" tabindex="0"><div class="stat-label" data-i18n="late">Kasne</div><div class="stat-value">${late}</div></div>
    <div class="${cardCls("in_purchase")} amber" data-filter="in_purchase" role="button" tabindex="0"><div class="stat-label" data-i18n="in_purchase">U nabavci</div><div class="stat-value">${inPurchase}</div></div>
    <div class="${cardCls("finished_today")} teal" data-filter="finished_today" role="button" tabindex="0"><div class="stat-label" data-i18n="finished_today">Danas završeno</div><div class="stat-value">${finishedToday}</div></div>
  `;
  document.getElementById("stat-cards").querySelectorAll("[data-filter]").forEach((card) => {
    card.addEventListener("click", () => selectFilter(card.dataset.filter));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFilter(card.dataset.filter); } });
  });
}

function renderChart(orders) {
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d;
  });
  const counts = days.map((d) => orders.filter((o) => o.createdAt?.toDate?.().toDateString() === d.toDateString()).length);
  const max = Math.max(1, ...counts);
  document.getElementById("chart-orders").innerHTML = days.map((d, i) => `
    <div title="${d.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sr-RS')}: ${counts[i]}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;">
      <span style="font-size:10px;font-weight:700;color:var(--color-text);margin-bottom:3px;">${counts[i] || ""}</span>
      <div style="width:70%;background:var(--color-primary);border-radius:4px 4px 0 0;height:${(counts[i] / max) * 85}%;min-height:${counts[i] ? 4 : 2}px;"></div>
      <span style="font-size:10px;color:var(--color-text-muted);margin-top:4px;">${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.</span>
    </div>
  `).join("");
}

function renderMetrics(orders) {
  const closed = orders.filter((o) => o.status === "zatvorena" && o.createdAt && o.confirmedAt);
  if (closed.length) {
    const avgMs = closed.reduce((sum, o) => sum + (o.confirmedAt.toDate() - o.createdAt.toDate()), 0) / closed.length;
    const hours = (avgMs / 3600000).toFixed(1);
    document.getElementById("avg-processing-time").textContent = `${hours} h`;
  } else {
    document.getElementById("avg-processing-time").textContent = "—";
  }
  const claims = orders.filter((o) => o.status === "reklamacija").length;
  const rate = orders.length ? (100 - (claims / orders.length) * 100).toFixed(0) : 100;
  document.getElementById("success-rate").textContent = t("success_rate_text", { rate, claims });
}

function renderOrdersTable(orders) {
  const body = document.getElementById("orders-body");
  if (!orders.length) {
    const msg = activeFilter || searchTerm ? t("no_orders_for_filter") : t("no_orders");
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${msg}</td></tr>`;
    return;
  }
  body.innerHTML = orders.slice(0, 100).map((o) => `
    <tr class="row-link" data-id="${o.id}">
      <td class="mono">${o.orderNumber}</td>
      <td>${escapeHtml(o.createdByName || "—")}</td>
      <td>${escapeHtml(o.assignedToName || "—")}</td>
      <td>${o.priority === "hitno" ? `<span class="badge badge-urgent">${t("urgent")}</span>` : `<span class="badge badge-gray">${t("standard")}</span>`}</td>
      <td><span class="badge ${badgeClassForStatus(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${formatDate(o.createdAt)}</td>
      <td>${o.status === "zatvorena" && (o.closedAt || o.updatedAt) ? formatDate(o.closedAt || o.updatedAt) : t("not_closed_yet")}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".row-link").forEach((row) => {
    row.addEventListener("click", () => { window.location.href = `./order-detail.html?order=${row.dataset.id}`; });
  });
}
