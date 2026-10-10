import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import {
  listenOrdersSince, listenOpenOrdersBy, listenRecentClosedBy,
  getOrdersPageBy, countOrdersBy, searchOrdersByNumberPrefix, getAverageProcessingMs,
} from "./orders.js";
import { isLate, allViewList, compareByCreatedDesc, toMillis, orderNumberPrefix, PAGE_SIZE, CLOSED_LIVE_HOURS } from "./dash-logic.js";
import { formatDate, escapeHtml, badgeClassForStatus, statusLabel, ROLES, roleLabel, debounce, toast } from "./utils.js";

await loadLang();

// Lista narudžbina (isti model kao na tablama naručioca/isporučioca):
//  • otvorene (uživo) + zatvorene u poslednja 2 dana (uživo) → kartice, tačne i kad firma ima više od 200 narudžbina
//  • cela istorija po datumu kreiranja u turama po 30 ("Učitaj još")
//  • ukupan broj narudžbina firme iz baze (Y u "Prikazano X od Y")
const D = {
  open: [], today: [], pages: [], cursor: null, exhausted: false, loadingPage: false, gotPage: false,
  gotOpen: false, gotToday: false, total: null, totalLoading: false, openSig: null,
  visible: PAGE_SIZE, list: [],
  searchResults: [], searchLoading: false, searchCapped: false, searchSeq: 0, // pretraga po početku broja — u bazi
  avgMs: null, // prosečno vreme obrade svih narudžbina (agregacija u bazi)
};
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

const byId = (...lists) => { const m = new Map(); lists.forEach((l) => l.forEach((o) => m.set(o.id, o))); return m; };
const base = () => Array.from(byId(D.today, D.open).values());       // za kartice i filtere
const liveMap = () => byId(D.pages, D.today, D.open);                  // novije verzije pobeđuju
const inAllMode = () => !searchTerm && !activeFilter;
const floorMs = () => (D.exhausted ? -Infinity : (toMillis(D.cursor?.data?.().createdAt) ?? Infinity));

function getPool() {
  if (searchTerm) {
    const live = liveMap();
    return D.searchResults.map((o) => live.get(o.id) || o).sort(compareByCreatedDesc);
  }
  if (activeFilter) return base().filter(FILTERS[activeFilter].predicate).sort(compareByCreatedDesc);
  return allViewList(Array.from(liveMap().values()), { floorMs: floorMs(), compare: () => () => 0 });
}

let loadPage = () => {}, loadTotal = () => {}, loadAvg = () => {}, runSearch = () => {}; // dodeljuju se kad se korisnik prijavi

requireAuth([ROLES.ADMIN], (user, profile) => {
  const companyId = profile.companyId;
  renderNav({ companyId, uid: user.uid, profile });
  document.getElementById("company-name-eyebrow").textContent = roleLabel("admin");

  loadPage = async () => {
    if (D.loadingPage || D.exhausted) return;
    D.loadingPage = true; renderPager();
    try {
      const res = await getOrdersPageBy(companyId, null, null, D.cursor, PAGE_SIZE);
      D.pages = D.pages.concat(res.orders);
      D.cursor = res.cursor || D.cursor;
      D.exhausted = !res.hasMore;
    } catch (err) {
      console.error(err);
      toast(t("dash_load_error"), "error");
    } finally {
      D.gotPage = true; D.loadingPage = false;
      refresh();
    }
  };
  loadTotal = async () => {
    if (D.totalLoading) return;
    D.totalLoading = true;
    try { D.total = await countOrdersBy(companyId, null, null); }
    catch (err) { console.error("Brojanje narudžbina:", err); }
    finally { D.totalLoading = false; renderPager(); renderMetrics(); }
  };
  loadAvg = async () => {
    try { D.avgMs = await getAverageProcessingMs(companyId); }
    catch (err) { console.error("Prosečno vreme obrade:", err); }
    renderMetrics();
  };
  // Pretraga po početku broja narudžbine radi u bazi (bez učitavanja istorije)
  runSearch = async () => {
    const seq = ++D.searchSeq;
    if (!searchTerm) { D.searchLoading = false; D.searchResults = []; refresh(); return; }
    D.searchLoading = true; refresh();
    try {
      const { orders, capped } = await searchOrdersByNumberPrefix(companyId, orderNumberPrefix(searchTerm));
      if (seq !== D.searchSeq) return; // u međuvremenu je pokrenuta novija pretraga
      D.searchResults = orders; D.searchCapped = capped;
    } catch (err) {
      if (seq !== D.searchSeq) return;
      console.error(err);
      D.searchResults = []; D.searchCapped = false;
      toast(t("dash_load_error"), "error");
    }
    D.searchLoading = false;
    D.visible = PAGE_SIZE;
    refresh();
  };

  const onError = (err) => { console.error("Admin tabla — greška pri čitanju narudžbina:", err); toast(t("dash_load_error"), "error"); };
  listenOpenOrdersBy(companyId, null, null, (orders) => {
    const sig = orders.map((o) => o.id).sort().join(",");
    if (D.gotOpen && sig !== D.openSig && D.total != null) loadTotal(); // nova/obrisana narudžbina menja ukupan broj
    D.openSig = sig; D.open = orders; D.gotOpen = true;
    refresh();
  }, onError);
  listenRecentClosedBy(companyId, null, null, new Date(Date.now() - CLOSED_LIVE_HOURS * 3600000), (orders) => {
    D.today = orders; D.gotToday = true;
    loadAvg(); // zatvaranje (i upis vremena obrade) menja prosek
    refresh();
  }, onError);
  loadPage();
  loadTotal();

  const chartSince = new Date();
  chartSince.setDate(chartSince.getDate() - 13);
  chartSince.setHours(0, 0, 0, 0);
  listenOrdersSince(companyId, chartSince, (orders) => {
    chartOrders = orders;
    renderChart(chartOrders);
  }, (err) => console.error("Grafikon narudžbina:", err));

  // Kašnjenje zavisi od vremena — preračunaj brojke svakog minuta (bez čitanja iz baze)
  setInterval(() => {
    if (document.hidden || !D.gotOpen) return;
    refresh();
    renderChart(chartOrders); // pomera prozor od 14 dana posle ponoći
  }, 60000);
});


function refresh() {
  renderStats();
  renderFilterChip();
  renderOrdersTable();
  renderPager();
  renderMetrics();
}

document.getElementById("order-search").addEventListener("input", debounce((e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  D.visible = PAGE_SIZE;
  if (searchTerm) activeFilter = null; // pretraga ide preko cele istorije, pa se ne meša sa karticom
  runSearch();
}, 250));

function selectFilter(key) {
  activeFilter = activeFilter === key ? null : key; // drugi klik na istu karticu ukida filter
  D.visible = PAGE_SIZE;
  if (activeFilter && searchTerm) { // kartica ima prednost: briše se pretraga
    searchTerm = ""; document.getElementById("order-search").value = ""; D.searchSeq++; D.searchLoading = false;
  }
  refresh();
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

function renderStats() {
  const orders = base(); // otvorene + danas zatvorene (uživo) — tačno bez obzira na broj narudžbina u firmi
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

// Tačne vrednosti za celu firmu (ne za poslednjih 200 narudžbina):
//  • prosečno vreme obrade — agregacija u bazi nad svim zatvorenim narudžbinama (polje processingMs)
//  • uspešnost — reklamacije (trenutno otvorene, uživo) u odnosu na ukupan broj narudžbina iz baze
function renderMetrics() {
  document.getElementById("avg-processing-time").textContent = D.avgMs == null ? "—" : `${(D.avgMs / 3600000).toFixed(1)} h`;
  if (D.total == null || !D.gotOpen) { document.getElementById("success-rate").textContent = "—"; return; }
  const claims = D.open.filter((o) => o.status === "reklamacija").length;
  const rate = D.total ? (100 - (claims / D.total) * 100).toFixed(0) : 100;
  document.getElementById("success-rate").textContent = t("success_rate_text", { rate, claims });
}

function renderOrdersTable() {
  const body = document.getElementById("orders-body");
  D.list = getPool();
  if (!D.gotOpen || !D.gotToday || (inAllMode() && !D.gotPage) || (searchTerm && D.searchLoading)) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${t(searchTerm && D.searchLoading ? "dash_search_loading" : "loading_ellipsis")}</td></tr>`;
    return;
  }
  const orders = inAllMode() ? D.list : D.list.slice(0, D.visible); // u prikazu "sve" ture dolaze iz baze
  if (!orders.length) {
    const msg = activeFilter || searchTerm ? t("no_orders_for_filter") : t("no_orders");
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${msg}</td></tr>`;
    return;
  }
  body.innerHTML = orders.map((o) => `
    <tr class="row-link" data-id="${escapeHtml(o.id)}">
      <td class="mono">${escapeHtml(o.orderNumber)}</td>
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

// "Prikazano X od Y": bez filtera Y je ukupan broj narudžbina firme (iz baze); sa karticom ili
// pretragom Y je broj narudžbina koje tom kriterijumu odgovaraju.
function renderPager() {
  const host = document.getElementById("pager");
  const all = inAllMode();
  const inList = D.list.length;
  const shown = all ? inList : Math.min(D.visible, inList);
  const total = all ? Math.max(D.total ?? 0, inList) : inList;
  const canMore = all ? !D.exhausted : D.visible < inList;
  const loading = !D.gotOpen || !D.gotToday || (all && !D.gotPage) || (searchTerm && D.searchLoading);
  if (loading || (!total && !canMore)) { host.innerHTML = ""; return; }
  const totalText = all && D.total == null ? "…" : total;
  const capped = searchTerm && D.searchCapped ? ` <span class="muted">${t("dash_prefix_capped")}</span>` : "";
  host.innerHTML = `
    <span class="muted pager-count">${t("dash_showing_count", { shown, total: totalText })}</span>${capped}
    ${canMore ? `<button type="button" class="btn btn-sm btn-outline" id="load-more-btn" ${D.loadingPage ? "disabled" : ""}>${D.loadingPage ? t("loading_ellipsis") : t("dash_load_more")}</button>` : ""}`;
  document.getElementById("load-more-btn")?.addEventListener("click", () => {
    if (all) loadPage(); else { D.visible += PAGE_SIZE; renderOrdersTable(); renderPager(); }
  });
}
