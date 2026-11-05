import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import { getNarucioci, getIsporucioci } from "./users.js";
import { getCompanySettings } from "./settings.js";
import {
  buildReportDataset, applyReportFilters,
  aggregateByNarucilac, aggregateByIsporucilac, aggregateBySupplier, aggregateByItem, financialSummary,
} from "./reports.js";
import { groupItemsBySupplier, parseQty, fmtQty } from "./report-logic.js";
import { generateOrdersReportPdf } from "./order-print.js";
import { exportCsv, exportExcel, exportPdf } from "./import-export.js";
import { escapeHtml, toast, formatDate, ROLES, statusLabel, ORDER_STATUS_ALL, badgeClassForStatus } from "./utils.js";
import { getISO, setISO, initDatepickers } from "./datepicker.js";

await loadLang();

let companyId, actorName, currency = "RSD", company = null;
let ownerUid = null;    // naručilac vidi samo svoje narudžbine (zaključano na njegov uid)
let fullDataset = [];   // narudžbine (sa items+purchases) unutar izabranog perioda, bez narucilac/isporucilac/dobavljac/status filtera
let filteredRows = [];
const expanded = new Set();   // otvoreni redovi po tabovima („tab:ključ") — ostaju otvoreni i posle promene filtera
const aggCache = {};          // tab -> poslednja agregacija (za otvaranje i izvoz reda)  // posle primene svih filtera — osnova za sve tabove

requireAuth([ROLES.ADMIN, ROLES.NARUCILAC], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  const isNarucilac = profile.role === ROLES.NARUCILAC;
  if (isNarucilac) {
    ownerUid = user.uid;
    const eyebrow = document.getElementById("page-eyebrow");
    eyebrow.setAttribute("data-i18n", "role_narucilac");
    eyebrow.textContent = t("role_narucilac");
    // Naručilac je uvek on sam: filter po naručiocu i tab „Po naručiocima" nemaju smisla
    document.getElementById("f-narucilac").closest(".field").classList.add("hidden");
    document.querySelector('.tab-btn[data-tab="narucioci"]').classList.add("hidden");
  }

  const settings = await getCompanySettings(companyId);
  company = settings || null;
  currency = settings?.currency || "RSD";

  const [suppliers, narucioci, isporucioci] = await Promise.all([
    getSuppliers(companyId),
    isNarucilac ? Promise.resolve([]) : getNarucioci(companyId),
    getIsporucioci(companyId).catch(() => []),
  ]);

  document.getElementById("f-supplier").innerHTML += suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  document.getElementById("f-narucilac").innerHTML += narucioci.map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  document.getElementById("f-isporucilac").innerHTML += isporucioci.map((u) => `<option value="${u.uid}">${escapeHtml(u.name)}</option>`).join("");
  document.getElementById("f-status").innerHTML += ORDER_STATUS_ALL.map((val) => `<option value="${val}">${escapeHtml(statusLabel(val))}</option>`).join("");

  await runReport();
});

function fmtAmount(n) {
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return `${(Number(n) || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function runReport() {
  const dateFromVal = getISO(document.getElementById("f-date-from"));
  const dateToVal = getISO(document.getElementById("f-date-to"));
  const dateFrom = dateFromVal ? new Date(dateFromVal + "T00:00:00") : null;
  const dateTo = dateToVal ? new Date(dateToVal + "T23:59:59") : null;

  const btn = document.getElementById("run-report-btn");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = t("loading_ellipsis");
  try {
    fullDataset = await buildReportDataset(companyId, { dateFrom, dateTo, ownerUid });
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    toast(t("toast_report_load_error"), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

function applyFiltersAndRender() {
  filteredRows = applyReportFilters(fullDataset, {
    narucilacUid: ownerUid || document.getElementById("f-narucilac").value,
    isporucilacUid: document.getElementById("f-isporucilac").value,
    supplierId: document.getElementById("f-supplier").value,
    status: document.getElementById("f-status").value,
    requestedBy: document.getElementById("f-requested-by").value,
  });
  document.getElementById("report-meta").textContent = t("report_meta_count", { count: filteredRows.length });
  renderOrdersTab();
  renderNarucioci();
  renderIsporucioci();
  renderSuppliersTab();
  renderItemsTab();
  renderFinanceTab();
}

// --------------------------------------------------------------- PO NARUDŽBENICAMA
function isoToDmy(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
}

// Detalji jedne narudžbenice (prikazuju se ispod reda kad je štiklirano „Detaljno"):
// stavke po dobavljaču + finansijski pregled — isti sadržaj kao u PDF-u narudžbenice.
function orderDetailHtml(r) {
  const groups = groupItemsBySupplier(r.items || []);
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  const itemsHtml = groups.length ? groups.map((g) => `
    <div class="rep-detail-supplier">${t("supplier")}: ${escapeHtml(g.name)}</div>
    <table class="data-table rep-detail-table">
      <thead><tr><th>${t("code")}</th><th>${t("product_label")}</th><th>${t("quantity")}</th><th>${t("delivery_location_label")}</th><th>${t("note")}</th></tr></thead>
      <tbody>${g.items.map((it) => `
        <tr>
          <td class="mono">${escapeHtml(it.code || "—")}</td>
          <td>${escapeHtml(it.productName || "—")}</td>
          <td>${fmtQty(parseQty(it.quantity), locale)} ${escapeHtml(it.unit || "")}</td>
          <td>${escapeHtml(it.deliveryLocationName || "—")}</td>
          <td>${escapeHtml(it.note || "—")}</td>
        </tr>`).join("")}
      </tbody>
    </table>`).join("") : `<p class="muted">${t("report_no_items")}</p>`;

  const paid = (r.purchases || []).filter((p) => p.paidAmount);
  const financeHtml = paid.length ? `
    <div class="rep-detail-finance">${t("finance_overview_title")}</div>
    <table class="data-table rep-detail-table">
      <thead><tr><th>${t("supplier")}</th><th>${t("receipt_number_label")}</th><th>${t("receipt_date_label")}</th><th style="text-align:right;">${t("amount_label")}</th></tr></thead>
      <tbody>${paid.map((p) => `
        <tr>
          <td>${escapeHtml(p.supplierName || "—")}</td>
          <td>${escapeHtml(p.receiptNumber || "—")}</td>
          <td>${escapeHtml(isoToDmy(p.receiptDate) || "—")}</td>
          <td style="text-align:right;">${fmtAmount(p.paidAmount)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="rep-detail-total">${t("order_total_label_caps")} ${fmtAmount(r.total)}</div>` : "";

  return itemsHtml + financeHtml;
}

function renderOrdersTab() {
  const body = document.getElementById("orders-body");
  if (!filteredRows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="8">${t("no_orders_for_filters")}</td></tr>`; return; }
  const detailed = document.getElementById("f-detailed").checked;
  body.innerHTML = filteredRows.map((r) => `
    <tr>
      <td class="mono"><a href="./order-detail.html?order=${r.id}">${escapeHtml(r.orderNumber)}</a></td>
      <td>${formatDate(r.createdAt)}</td>
      <td>${escapeHtml(r.createdByName || "—")}</td>
      <td>${escapeHtml(r.requestedByName || "—")}</td>
      <td>${escapeHtml(r.assignedToName || "—")}</td>
      <td><span class="badge ${badgeClassForStatus(r.status)}">${escapeHtml(statusLabel(r.status))}</span></td>
      <td>${r.itemCount ?? (r.items || []).length}</td>
      <td>${r.total > 0 ? `<strong>${fmtAmount(r.total)}</strong>` : "—"}</td>
    </tr>
    ${detailed ? `<tr class="rep-detail-row"><td colspan="8">${orderDetailHtml(r)}</td></tr>` : ""}
  `).join("");
}

// --------------------------------------------------------------- DRILL-DOWN (klik na red → lista narudžbenica)
const COL = {
  number: { head: () => t("export_col_number"), html: (o) => `<a class="mono" href="./order-detail.html?order=${o.r.id}">${escapeHtml(o.r.orderNumber)}</a>`, text: (o) => o.r.orderNumber },
  date: { head: () => t("export_col_date"), html: (o) => formatDate(o.r.createdAt), text: (o) => formatDate(o.r.createdAt) },
  narucilac: { head: () => t("role_narucilac"), html: (o) => escapeHtml(o.r.createdByName || "—"), text: (o) => o.r.createdByName || "—" },
  isporucilac: { head: () => t("role_isporucilac"), html: (o) => escapeHtml(o.r.assignedToName || t("not_assigned")), text: (o) => o.r.assignedToName || t("not_assigned") },
  status: { head: () => t("status"), html: (o) => `<span class="badge ${badgeClassForStatus(o.r.status)}">${escapeHtml(statusLabel(o.r.status))}</span>`, text: (o) => statusLabel(o.r.status) },
  total: { head: () => t("export_col_total_amount"), money: true, html: (o) => (o.r.total > 0 ? `<strong>${fmtAmount(o.r.total)}</strong>` : "—"), text: (o) => o.r.total.toFixed(2) },
  paid: { head: () => t("report_col_paid_to_supplier"), money: true, html: (o) => (o.amount > 0 ? `<strong>${fmtAmount(o.amount)}</strong>` : "—"), text: (o) => o.amount.toFixed(2) },
  qty: { head: () => t("quantity"), html: (o, a) => `<strong>${fmtQty(o.quantity, currentLang === "en" ? "en-GB" : "sr-RS")}</strong> ${escapeHtml(a.unit || "")}`, text: (o) => o.quantity },
  unit: { head: () => t("unit"), exportOnly: true, text: (o, a) => a.unit || "—" },
};
const DRILL_COLS = {
  narucioci: ["number", "date", "isporucilac", "status", "total"],
  isporucioci: ["number", "date", "narucilac", "status", "total"],
  suppliers: ["number", "date", "narucilac", "isporucilac", "status", "paid"],
  items: ["number", "date", "narucilac", "isporucilac", "status", "qty", "unit"],
};
const CHEV = `<span class="rep-chevron" aria-hidden="true">▸</span>`;

function drillDetailHtml(tab, a) {
  const cols = DRILL_COLS[tab].map((k) => COL[k]).filter((c) => !c.exportOnly);
  const key = escapeHtml(a.key);
  const btn = (kind, label) => `<button class="btn btn-sm btn-outline" data-drill-export="${kind}" data-tab="${tab}" data-key="${key}">${label}</button>`;
  return `
    <div class="rep-drill-bar">
      <strong>${t("report_meta_count", { count: a.orders.length })}</strong>
      <span style="display:flex;gap:8px;">${btn("csv", "⇩ CSV")}${btn("excel", "⇩ Excel")}${btn("pdf", "⇩ PDF")}</span>
    </div>
    <table class="data-table rep-detail-table">
      <thead><tr>${cols.map((c) => `<th>${c.head()}</th>`).join("")}</tr></thead>
      <tbody>${a.orders.map((o) => `<tr>${cols.map((c) => `<td>${c.html(o, a)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

// Generički prikaz taba: red agregacije (klikabilan) + ispod njega, ako je otvoren, lista narudžbenica.
function renderAggTab(tab, bodyId, agg, colCount, cellsFn) {
  const body = document.getElementById(bodyId);
  aggCache[tab] = agg;
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">${t("no_data")}</td></tr>`; return; }
  body.innerHTML = agg.map((a) => {
    const open = expanded.has(`${tab}:${a.key}`);
    return `
    <tr class="rep-drill-toggle" data-key="${escapeHtml(a.key)}" tabindex="0" role="button" aria-expanded="${open}">${cellsFn(a)}</tr>
    ${open ? `<tr class="rep-detail-row"><td colspan="${colCount}">${drillDetailHtml(tab, a)}</td></tr>` : ""}`;
  }).join("");
}

const nameAmountCells = (a) => `<td>${CHEV}${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td>`;

// --------------------------------------------------------------- PO NARUČIOCIMA
function renderNarucioci() { renderAggTab("narucioci", "narucioci-body", aggregateByNarucilac(filteredRows), 3, nameAmountCells); }

// --------------------------------------------------------------- PO ISPORUČIOCIMA
function renderIsporucioci() { renderAggTab("isporucioci", "isporucioci-body", aggregateByIsporucilac(filteredRows), 3, nameAmountCells); }

// --------------------------------------------------------------- PO DOBAVLJAČIMA
function renderSuppliersTab() { renderAggTab("suppliers", "suppliers-body-report", aggregateBySupplier(filteredRows), 3, nameAmountCells); }

// --------------------------------------------------------------- PO ARTIKLIMA
function renderItemsTab() {
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  renderAggTab("items", "items-body", aggregateByItem(filteredRows), 5, (a) => `
      <td class="mono">${CHEV}${escapeHtml(a.code || "—")}</td>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.unit || "—")}</td>
      <td><strong>${fmtQty(a.quantity, locale)}</strong></td>
      <td>${a.orderCount}</td>`);
}

const TAB_BODY = { narucioci: "narucioci-body", isporucioci: "isporucioci-body", suppliers: "suppliers-body-report", items: "items-body" };
const TAB_RENDER = { narucioci: renderNarucioci, isporucioci: renderIsporucioci, suppliers: renderSuppliersTab, items: renderItemsTab };

Object.entries(TAB_BODY).forEach(([tab, bodyId]) => {
  const body = document.getElementById(bodyId);
  const toggle = (tr) => {
    const id = `${tab}:${tr.dataset.key}`;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    TAB_RENDER[tab]();
  };
  body.addEventListener("click", (e) => {
    const exp = e.target.closest("button[data-drill-export]");
    if (exp) { runDrillExport(exp); return; }
    const tr = e.target.closest("tr.rep-drill-toggle");
    if (tr) toggle(tr);
  });
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr.rep-drill-toggle");
    if (tr && e.target === tr) { e.preventDefault(); toggle(tr); }
  });
});

// Izvoz liste narudžbenica jednog otvorenog reda (dobavljač / isporučilac / naručilac / artikal)
function slugify(str) {
  return String(str || "").toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "red";
}

async function runDrillExport(btn) {
  const { tab, key } = btn.dataset;
  const a = (aggCache[tab] || []).find((x) => x.key === key);
  if (!a || !a.orders.length) { toast(t("toast_no_data_to_export"), "error"); return; }
  const cols = DRILL_COLS[tab].map((k) => COL[k]);
  const rows = a.orders.map((o) => Object.fromEntries(cols.map((c) => [c.money ? `${c.head()} (${currency})` : c.head(), c.text(o, a)])));
  const filename = `izvestaj-${tab}-${slugify(a.name)}-${new Date().toISOString().slice(0, 10)}`;
  const list = a.orders.map((o) => o.r);
  const total = tab === "items" ? null : tab === "suppliers" ? a.orders.reduce((s, o) => s + o.amount, 0) : list.reduce((s, r) => s + r.total, 0);
  const original = btn.textContent;
  btn.disabled = true;
  if (btn.dataset.drillExport === "pdf") btn.textContent = t("generating_pdf_ellipsis");
  try {
    if (btn.dataset.drillExport === "csv") exportCsv(filename, rows);
    if (btn.dataset.drillExport === "excel") await exportExcel(filename, rows, t("reports"));
    if (btn.dataset.drillExport === "pdf") await exportPdf(filename, t("report_title_drill", { name: a.name }), rows, { company, subtitle: reportSubtitle(list, total) });
  } catch (err) {
    console.error(err);
    toast(t("toast_export_error"), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// --------------------------------------------------------------- FINANSIJSKI PREGLED
function renderFinanceTab() {
  const s = financialSummary(filteredRows);
  document.getElementById("finance-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">${t("finance_total_orders")}</div><div class="stat-value">${s.totalOrders}</div></div>
    <div class="stat-card teal"><div class="stat-label">${t("finance_with_amount")}</div><div class="stat-value">${s.ordersWithFinance}</div></div>
    <div class="stat-card amber"><div class="stat-label">${t("finance_without_amount")}</div><div class="stat-value">${s.ordersWithoutFinance}</div></div>
    <div class="stat-card"><div class="stat-label">${t("finance_total_amount")}</div><div class="stat-value" style="font-size:22px;">${fmtAmount(s.totalAmount)}</div></div>
  `;
}

// --------------------------------------------------------------- IZVOZ
// „Detaljno" za CSV/Excel: jedan red po stavci narudžbine; podaci narudžbine se ponavljaju,
// a iznos narudžbine je samo u prvom redu svake narudžbine (da zbir kolone bude tačan).
function detailedOrderRows() {
  const out = [];
  filteredRows.forEach((r) => {
    const base = {
      [t("export_col_order_number")]: r.orderNumber,
      [t("export_col_date")]: formatDate(r.createdAt),
      [t("role_narucilac")]: r.createdByName || "—",
      [t("requested_by_meta_label")]: r.requestedByName || "—",
      [t("role_isporucilac")]: r.assignedToName || "—",
      [t("status")]: statusLabel(r.status),
    };
    const amountKey = `${t("export_col_total_amount")} (${currency})`;
    const items = r.items || [];
    if (!items.length) {
      out.push({ ...base, [t("supplier")]: "—", [t("code")]: "—", [t("product_label")]: "—", [t("quantity")]: "", [t("unit")]: "", [t("delivery_location_label")]: "—", [t("note")]: "—", [amountKey]: r.total.toFixed(2) });
      return;
    }
    items.forEach((it, i) => {
      out.push({
        ...base,
        [t("supplier")]: it.supplierName || "—",
        [t("code")]: it.code || "—",
        [t("product_label")]: it.productName || "—",
        [t("quantity")]: parseQty(it.quantity),
        [t("unit")]: it.unit || "",
        [t("delivery_location_label")]: it.deliveryLocationName || "—",
        [t("note")]: it.note || "—",
        [amountKey]: i === 0 ? r.total.toFixed(2) : "",
      });
    });
  });
  return out;
}

function rowsForExport(view) {
  if (view === "items") {
    return aggregateByItem(filteredRows).map((a) => ({
      [t("code")]: a.code || "—",
      [t("product_label")]: a.name,
      [t("unit")]: a.unit || "—",
      [t("report_col_total_quantity")]: a.quantity,
      [t("export_col_order_count")]: a.orderCount,
    }));
  }
  if (view === "orders" && document.getElementById("f-detailed").checked) return detailedOrderRows();
  if (view === "orders") {
    return filteredRows.map((r) => ({
      [t("export_col_order_number")]: r.orderNumber,
      [t("export_col_date")]: formatDate(r.createdAt),
      [t("role_narucilac")]: r.createdByName || "—",
      [t("requested_by_meta_label")]: r.requestedByName || "—",
      [t("role_isporucilac")]: r.assignedToName || "—",
      [t("status")]: statusLabel(r.status),
      [t("export_col_item_count")]: r.itemCount ?? (r.items || []).length,
      [`${t("export_col_total_amount")} (${currency})`]: r.total.toFixed(2),
    }));
  }
  if (view === "narucioci") {
    return aggregateByNarucilac(filteredRows).map((a) => ({ [t("role_narucilac")]: a.name, [t("export_col_order_count")]: a.orderCount, [`${t("export_col_total_amount")} (${currency})`]: a.total.toFixed(2) }));
  }
  if (view === "isporucioci") {
    return aggregateByIsporucilac(filteredRows).map((a) => ({ [t("role_isporucilac")]: a.name, [t("export_col_order_count")]: a.orderCount, [`${t("export_col_total_amount")} (${currency})`]: a.total.toFixed(2) }));
  }
  if (view === "suppliers") {
    return aggregateBySupplier(filteredRows).map((a) => ({ [t("supplier")]: a.name, [t("export_col_order_count")]: a.orderCount, [`${t("export_col_total_paid")} (${currency})`]: a.total.toFixed(2) }));
  }
  return [];
}

function pdfTitleFor(view) {
  const keys = {
    orders: "report_title_orders",
    narucioci: "report_title_narucioci",
    isporucioci: "report_title_isporucioci",
    suppliers: "report_title_suppliers",
    items: "report_title_items",
  };
  return t(keys[view]) || t("reports");
}

// Red ispod naslova PDF-a: period · broj narudžbina · ukupan iznos
function reportSubtitle(list = filteredRows, total = list.reduce((s, r) => s + r.total, 0)) {
  const from = getISO(document.getElementById("f-date-from"));
  const to = getISO(document.getElementById("f-date-to"));
  const period = (from || to)
    ? t("report_subtitle_period", { from: isoToDmy(from) || "…", to: isoToDmy(to) || "…" })
    : t("report_subtitle_all_periods");
  const parts = [period, t("report_subtitle_count", { count: list.length })];
  if (total !== null) parts.push(t("report_subtitle_total", { amount: fmtAmount(total) }));
  return parts.join("   ·   ");
}

document.querySelectorAll("button[data-export]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;
    const rows = rowsForExport(view);
    if (!rows.length) { toast(t("toast_no_data_to_export"), "error"); return; }
    const detailed = view === "orders" && document.getElementById("f-detailed").checked;
    const filename = `izvestaj-${view}${detailed ? "-detaljno" : ""}-${new Date().toISOString().slice(0, 10)}`;
    const original = btn.textContent;
    btn.disabled = true;
    if (btn.dataset.export === "pdf") btn.textContent = t("generating_pdf_ellipsis");
    try {
      if (btn.dataset.export === "csv") exportCsv(filename, rows);
      if (btn.dataset.export === "excel") await exportExcel(filename, rows, t("reports"));
      if (btn.dataset.export === "pdf") {
        if (detailed) {
          await generateOrdersReportPdf({ company, companyId, rows: filteredRows, subtitle: reportSubtitle(), filename });
        } else {
          await exportPdf(filename, pdfTitleFor(view), rows, { company, subtitle: reportSubtitle() });
        }
      }
    } catch (err) {
      console.error(err);
      toast(t("toast_export_error"), "error");
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
});

// --------------------------------------------------------------- TABOVI + FILTERI
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["orders", "narucioci", "isporucioci", "suppliers", "items", "finance"].forEach((tab) => {
      document.getElementById(`tab-${tab}`).classList.toggle("hidden", btn.dataset.tab !== tab);
    });
  });
});

document.getElementById("run-report-btn").addEventListener("click", runReport);
document.getElementById("f-detailed").addEventListener("change", renderOrdersTab);
document.getElementById("reset-filters-btn").addEventListener("click", () => {
  setISO(document.getElementById("f-date-from"), "");
  setISO(document.getElementById("f-date-to"), "");
  document.getElementById("f-narucilac").value = "";
  document.getElementById("f-isporucilac").value = "";
  document.getElementById("f-supplier").value = "";
  document.getElementById("f-status").value = "";
  document.getElementById("f-requested-by").value = "";
  runReport();
});
// Filteri koji ne zahtevaju ponovno učitavanje iz baze (narucilac/isporucilac/dobavljac/status/ko-je-trazio)
// primenjuju se odmah nad već učitanim setom narudžbina za izabrani period.
["f-narucilac", "f-isporucilac", "f-supplier", "f-status"].forEach((id) => {
  document.getElementById(id).addEventListener("change", applyFiltersAndRender);
});
document.getElementById("f-requested-by").addEventListener("input", applyFiltersAndRender);
