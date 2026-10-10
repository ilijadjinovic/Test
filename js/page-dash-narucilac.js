import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t } from "./i18n.js";
import {
  getOrderItems, getOrderDeliveryLocations, getOrderPurchases,
  confirmReceiptFull, repeatOrderAfterRejection,
} from "./orders.js";
import { getCompanySettings } from "./settings.js";
import { generateOrderPdf } from "./order-print.js";
import { formatDate, escapeHtml, ROLES, toast } from "./utils.js";
import { compareNarucilac, isAttentionNarucilac } from "./dash-logic.js";
import {
  createDashboard, statusCellHtml, priorityCellHtml, closedCellHtml,
} from "./dash-common.js";

await loadLang();

// Kontrolna tabla naručioca — sva logika (kartice, kasne, paginacija, pretraga)
// je u dash-common.js; ovde su samo kolone i akcije specifične za naručioca.
requireAuth([ROLES.NARUCILAC], (user, profile) => {
  const companyId = profile.companyId;
  renderNav({ companyId, uid: user.uid, profile });
  const actor = { actorUid: user.uid, actorName: profile.name };

  const actionsCell = (o) => {
    const btns = [];
    if (o.status === "isporucena") {
      btns.push(`<button type="button" class="btn btn-sm btn-primary" data-action="confirm" data-id="${escapeHtml(o.id)}">${t("confirm_receipt")}</button>`);
    }
    if (o.status === "odbijena") {
      btns.push(o.repeatedAsOrderId
        ? `<a class="repeated-link" href="./order-detail.html?order=${escapeHtml(o.repeatedAsOrderId)}">${t("dash_repeated_as", { number: escapeHtml(o.repeatedAsNumber || "") })}</a>`
        : `<button type="button" class="btn btn-sm btn-amber" data-action="repeat" data-id="${escapeHtml(o.id)}">${t("dash_repeat_order")}</button>`);
    }
    btns.push(`<button type="button" class="btn btn-sm btn-outline" data-action="pdf" data-id="${escapeHtml(o.id)}" title="${t("download_order_pdf_title")}">🖨️ PDF</button>`);
    return `<div class="row-actions">${btns.join("")}</div>`;
  };

  createDashboard({
    companyId, uid: user.uid, ownerField: "createdByUid",
    cardKeys: ["awaiting_confirm", "claims", "late", "in_purchase", "finished_today", "all"],
    compare: compareNarucilac,
    isAttention: isAttentionNarucilac,
    emptyKey: "no_orders_yet",
    rowClass: (o) => (o.status === "odbijena" ? "row-rejected" : ""),
    columns: [
      { headKey: "export_col_number", cls: "mono", render: (o) => escapeHtml(o.orderNumber) },
      { headKey: "dash_actions", render: actionsCell },
      { headKey: "status", render: (o, ctx) => statusCellHtml(o, { showReason: true, now: ctx.now }) },
      { headKey: "priority", render: priorityCellHtml },
      { headKey: "role_isporucilac", render: (o) => escapeHtml(o.assignedToName || "—") },
      { headKey: "created_label", render: (o) => formatDate(o.createdAt) },
      { headKey: "closed_label", render: closedCellHtml },
    ],
    actions: {
      // Brza potvrda: sva roba je primljena u celosti. Ako nešto fali, naručilac
      // otvara detalje (unos primljenih količina, prenos manjka, reklamacija).
      async confirm(o) {
        if (!confirm(t("dash_confirm_receipt_prompt", { number: o.orderNumber }))) return;
        await confirmReceiptFull(companyId, o.id, actor);
        toast(t("toast_receipt_confirmed_closed"), "success");
      },
      async repeat(o) {
        if (!confirm(t("dash_repeat_confirm", { number: o.orderNumber }))) return;
        const res = await repeatOrderAfterRejection(companyId, o.id, actor);
        toast(t("dash_repeat_done", { number: res.orderNumber }), "success");
      },
      async pdf(o, { button }) {
        const original = button.textContent;
        button.textContent = t("generating_ellipsis");
        try {
          const [items, deliveryLocations, purchases, company] = await Promise.all([
            getOrderItems(companyId, o.id), getOrderDeliveryLocations(companyId, o.id),
            getOrderPurchases(companyId, o.id), getCompanySettings(companyId),
          ]);
          await generateOrderPdf({ company, order: o, items, purchases, deliveryLocations, companyId });
        } catch (err) {
          console.error(err);
          toast(t("toast_pdf_generate_error"), "error");
        } finally {
          button.textContent = original;
        }
      },
    },
  }).start();
});
