import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import { acceptOrder, rejectOrder } from "./orders.js";
import { formatDate, escapeHtml, ROLES, toast } from "./utils.js";
import { compareIsporucilac, isAttentionIsporucilac } from "./dash-logic.js";
import {
  createDashboard, statusCellHtml, priorityCellHtml, closedCellHtml, listCellHtml,
} from "./dash-common.js";

await loadLang();

// Kontrolna tabla isporučioca — sva logika je u dash-common.js; ovde su kolone i
// akcije specifične za isporučioca. Akcije su iste kao u detaljima narudžbine
// (isti acceptOrder/rejectOrder i isto pitanje za razlog odbijanja).
requireAuth([ROLES.ISPORUCILAC], (user, profile) => {
  const companyId = profile.companyId;
  renderNav({ companyId, uid: user.uid, profile });
  const actor = { actorUid: user.uid, actorName: profile.name };

  const actionsCell = (o) => (o.status === "ceka_prihvatanje"
    ? `<div class="row-actions">
         <button type="button" class="btn btn-sm btn-primary" data-action="accept" data-id="${escapeHtml(o.id)}">${t("accept")}</button>
         <button type="button" class="btn btn-sm btn-danger" data-action="reject" data-id="${escapeHtml(o.id)}">${t("reject")}</button>
       </div>`
    : "—");

  createDashboard({
    companyId, uid: user.uid, ownerField: "assignedToUid",
    cardKeys: ["awaiting_accept", "claims", "late", "active_deliveries", "in_purchase", "finished_today"],
    compare: compareIsporucilac,
    isAttention: isAttentionIsporucilac,
    activeOnlyDefault: true,      // podrazumevano samo aktivne, "Prikaži sve" dodaje zatvorene/odbijene
    emptyKey: "no_orders",
    columns: [
      { headKey: "export_col_number", cls: "mono", render: (o) => escapeHtml(o.orderNumber) },
      { headKey: "dash_actions", render: actionsCell },
      { headKey: "status", render: (o, ctx) => statusCellHtml(o, { now: ctx.now }) },
      { headKey: "role_narucilac", render: (o) => escapeHtml(o.createdByName || "—") },
      { headKey: "priority", render: priorityCellHtml },
      { headKey: "dash_delivery_location", cls: "wrap-col", render: (o) => listCellHtml(o.deliveryLocationNames) },
      { headKey: "dash_suppliers", cls: "wrap-col", render: (o) => listCellHtml(o.supplierNames) },
      { headKey: "dash_assigned_label", render: (o) => formatDate(o.assignedAt || o.createdAt) },
      { headKey: "closed_label", render: closedCellHtml },
    ],
    rowClass: (o) => (o.status === "odbijena" ? "row-rejected" : ""),
    actions: {
      async accept(o) {
        await acceptOrder(companyId, o.id, { ...actor, orderCreatedByUid: o.createdByUid });
        toast(t("toast_order_accepted"), "success");
      },
      async reject(o) {
        const reason = prompt(t("prompt_rejection_reason"));
        if (reason === null) return;
        await rejectOrder(companyId, o.id, { reason, ...actor, orderCreatedByUid: o.createdByUid });
        toast(t("toast_order_rejected"), "success");
      },
    },
  }).start();
});
