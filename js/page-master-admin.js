import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { listenAllCompanies, getGlobalStats, blockCompany, deleteCompany } from "./companies.js";
import { getRecentAuditLogs } from "./audit.js";
import { formatDate, escapeHtml, toast } from "./utils.js";
import { ROLES } from "./utils.js";

await loadLang();

requireAuth([ROLES.MASTER_ADMIN], (user, profile) => {
  renderNav({ companyId: "platform", uid: user.uid, profile });
  refreshStats();
  listenAllCompanies(renderCompanies);
});

async function refreshStats() {
  const stats = await getGlobalStats();
  document.getElementById("global-stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">${t("stat_total_companies")}</div><div class="stat-value">${stats.totalCompanies}</div></div>
    <div class="stat-card teal"><div class="stat-label">${t("stat_active_companies")}</div><div class="stat-value">${stats.activeCompanies}</div></div>
    <div class="stat-card red"><div class="stat-label">${t("stat_blocked_companies")}</div><div class="stat-value">${stats.blockedCompanies}</div></div>
    <div class="stat-card amber"><div class="stat-label">${t("stat_total_orders")}</div><div class="stat-value">${stats.totalOrders}</div></div>
  `;
}

function renderCompanies(companies) {
  const body = document.getElementById("companies-body");
  if (!companies.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${t("no_registered_companies")}</td></tr>`;
    return;
  }
  body.innerHTML = companies.map((c) => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.pib || "—")}</td>
      <td>${escapeHtml(c.email || "—")}</td>
      <td><span class="badge ${c.status === "blocked" ? "badge-red" : "badge-teal"}">${c.status === "blocked" ? t("blocked") : t("active")}</span></td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-action="logs" data-id="${c.id}">${t("audit_log_short")}</button>
        <button class="btn btn-sm ${c.status === "blocked" ? "btn-amber" : "btn-outline"}" data-action="block" data-id="${c.id}" data-blocked="${c.status === "blocked"}">
          ${c.status === "blocked" ? t("unblock") : t("block")}
        </button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${c.id}">${t("delete")}</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === "logs") return loadLogs(id);
      if (btn.dataset.action === "block") {
        await blockCompany(id, btn.dataset.blocked !== "true");
        toast(t("toast_company_status_updated"), "success");
      }
      if (btn.dataset.action === "delete") {
        if (!confirm(t("confirm_delete_company"))) return;
        await deleteCompany(id);
        toast(t("toast_company_deleted"), "success");
        refreshStats();
      }
    });
  });
}

async function loadLogs(companyId) {
  const body = document.getElementById("audit-body");
  body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("loading_ellipsis")}</td></tr>`;
  const logs = await getRecentAuditLogs(companyId, 50);
  if (!logs.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("no_logged_actions")}</td></tr>`;
    return;
  }
  body.innerHTML = logs.map((l) => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td>${escapeHtml(l.action)}</td>
      <td>${escapeHtml(l.actorName || t("system_actor_fallback"))}</td>
      <td>${escapeHtml(l.details || "—")}</td>
    </tr>
  `).join("");
}
