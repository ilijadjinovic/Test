import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import { getSuppliers } from "./suppliers.js";
import { getNarucioci, getIsporucioci } from "./users.js";
import { getCompanySettings } from "./settings.js";
import {
  buildReportDataset, applyReportFilters,
  aggregateByNarucilac, aggregateByIsporucilac, aggregateBySupplier, financialSummary,
} from "./reports.js";
import { exportCsv, exportExcel, exportPdf } from "./import-export.js";
import { escapeHtml, toast, formatDate, ROLES, statusLabel, ORDER_STATUS_ALL, badgeClassForStatus } from "./utils.js";
import { getISO, setISO, initDatepickers } from "./datepicker.js";

await loadLang();

let companyId, actorName, currency = "RSD";
let fullDataset = [];   // narudžbine (sa items+purchases) unutar izabranog perioda, bez narucilac/isporucilac/dobavljac/status filtera
let filteredRows = [];  // posle primene svih filtera — osnova za sve tabove

requireAuth([ROLES.ADMIN], async (user, profile) => {
  companyId = profile.companyId; actorName = profile.name;
  renderNav({ companyId, uid: user.uid, profile });

  const settings = await getCompanySettings(companyId);
  currency = settings?.currency || "RSD";

  const [suppliers, narucioci, isporucioci] = await Promise.all([
    getSuppliers(companyId), getNarucioci(companyId), getIsporucioci(companyId),
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
    fullDataset = await buildReportDataset(companyId, { dateFrom, dateTo });
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
    narucilacUid: document.getElementById("f-narucilac").value,
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
  renderFinanceTab();
}

// --------------------------------------------------------------- PO NARUDŽBENICAMA
function renderOrdersTab() {
  const body = document.getElementById("orders-body");
  if (!filteredRows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="8">${t("no_orders_for_filters")}</td></tr>`; return; }
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
  `).join("");
}

// --------------------------------------------------------------- PO NARUČIOCIMA
function renderNarucioci() {
  const body = document.getElementById("narucioci-body");
  const agg = aggregateByNarucilac(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">${t("no_data")}</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
}

// --------------------------------------------------------------- PO ISPORUČIOCIMA
function renderIsporucioci() {
  const body = document.getElementById("isporucioci-body");
  const agg = aggregateByIsporucilac(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">${t("no_data")}</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
}

// --------------------------------------------------------------- PO DOBAVLJAČIMA
function renderSuppliersTab() {
  const body = document.getElementById("suppliers-body-report");
  const agg = aggregateBySupplier(filteredRows);
  if (!agg.length) { body.innerHTML = `<tr class="empty-row"><td colspan="3">${t("no_data")}</td></tr>`; return; }
  body.innerHTML = agg.map((a) => `
    <tr><td>${escapeHtml(a.name)}</td><td>${a.orderCount}</td><td><strong>${fmtAmount(a.total)}</strong></td></tr>
  `).join("");
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
function rowsForExport(view) {
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
  };
  return t(keys[view]) || t("reports");
}

document.querySelectorAll("button[data-export]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;
    const rows = rowsForExport(view);
    if (!rows.length) { toast(t("toast_no_data_to_export"), "error"); return; }
    const filename = `izvestaj-${view}-${new Date().toISOString().slice(0, 10)}`;
    try {
      if (btn.dataset.export === "csv") exportCsv(filename, rows);
      if (btn.dataset.export === "excel") await exportExcel(filename, rows, t("reports"));
      if (btn.dataset.export === "pdf") await exportPdf(filename, pdfTitleFor(view), rows);
    } catch (err) {
      console.error(err);
      toast(t("toast_export_error"), "error");
    }
  });
});

// --------------------------------------------------------------- TABOVI + FILTERI
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["orders", "narucioci", "isporucioci", "suppliers", "finance"].forEach((tab) => {
      document.getElementById(`tab-${tab}`).classList.toggle("hidden", btn.dataset.tab !== tab);
    });
  });
});

document.getElementById("run-report-btn").addEventListener("click", runReport);
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
