import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { getTemplates, deleteTemplate, isDueToday } from "./templates.js";
import { escapeHtml, toast, ROLES } from "./utils.js";

await loadLang();
let companyId;
let activeType = "sablon";

requireAuth([ROLES.NARUCILAC], (user, profile) => {
  companyId = profile.companyId;
  renderNav({ companyId, uid: user.uid, profile });
  load();
});

async function load() {
  const body = document.getElementById("templates-body");
  body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("loading_ellipsis")}</td></tr>`;
  const list = await getTemplates(companyId, activeType);
  if (!list.length) { body.innerHTML = `<tr class="empty-row"><td colspan="4">${t("no_saved_items_in_category")}</td></tr>`; return; }

  body.innerHTML = list.map((tp) => {
    const preview = tp.items.slice(0, 3).map((i) => `${escapeHtml(i.productName)} (${i.quantity} ${escapeHtml(i.unit)})`).join(", ");
    const more = tp.items.length > 3 ? ` + ${tp.items.length - 3} ${t("more_suffix")}` : "";
    const recurring = tp.type === "ponavljajuca"
      ? `${(tp.recurringDays || []).join(", ") || "—"} ${isDueToday(tp) ? `<span class="badge badge-amber">${t("today")}</span>` : ""}`
      : `<span class="muted">—</span>`;
    return `
      <tr>
        <td><strong>${escapeHtml(tp.name)}</strong><div class="muted" style="font-size:12px;">${t("items_count", { count: tp.items.length })}</div></td>
        <td class="muted" style="font-size:13px;">${preview}${more}</td>
        <td>${recurring}</td>
        <td>
          <a class="btn btn-sm btn-amber" href="./new-order.html?template=${tp.id}">${t("order_action")}</a>
          <button class="btn btn-sm btn-danger" data-id="${tp.id}">${t("delete")}</button>
        </td>
      </tr>`;
  }).join("");

  body.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("confirm_delete_item"))) return;
      await deleteTemplate(companyId, btn.dataset.id);
      toast(t("toast_deleted"), "success");
      load();
    });
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeType = btn.dataset.type;
    load();
  });
});
