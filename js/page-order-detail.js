import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { loadLang, t, currentLang } from "./i18n.js";
import {
  listenOrder, listenOrderItems, listenOrderPurchases, listenDeliveryLocations,
  acceptOrder, rejectOrder, setOrderStatus, confirmReceipt, deleteOrderItem, deleteOrder, assignOrder,
  updateOrderItem, addOrderItem, updateOrderPriority, updateOrderRequestedBy, addOrderDeliveryLocation, removeOrderDeliveryLocation,
} from "./orders.js";
import { finishPurchase, markItemPurchased, markItemNotFound, markItemSubstitute, setPurchasePayment, calcOrderTotal } from "./purchases.js";
import { getSupplierLocations } from "./suppliers.js";
import { getProducts, smartSearch } from "./catalog.js";
import { getLocations } from "./locations.js";
import { generateOrderPdf } from "./order-print.js";
import { markLocationDelivered, confirmLocationReceipt } from "./deliveries.js";
import { openClaim, resolveClaim, listenClaims } from "./claims.js";
import { sendMessageAndNotify, listenMessages } from "./chat.js";
import { uploadAttachment, listenAttachments } from "./attachments.js";
import { orderQrUrl, renderQrCode } from "./qrcode.js";
import { getIsporucioci } from "./users.js";
import { getCompanySettings } from "./settings.js";
import {
  formatDate, escapeHtml, toast, getParam, badgeClassForStatus,
  ORDER_STATUS, statusLabel, ORDER_STATUS_FLOW, normalizeQuantity,
} from "./utils.js";
import { getISO, initDatepickers } from "./datepicker.js";

await loadLang();

const orderId = getParam("order");
if (!orderId) document.body.innerHTML = `<p style='padding:40px;'>${t("order_not_found_missing_id")}</p>`;

let companyId, uidValue, profile, companySettings = null;
let order = null, items = [], purchases = [], deliveryLocations = [], claims = [];

// Za editovanje narudžbine dok nije prihvaćena (Poglavlje 2.3, "ozbiljan edit svega"):
// keš proizvoda po dobavljaču (za "Dodaj artikal iz kataloga") i lista lokacija firme
// (za dodavanje novih lokacija isporuke). Učitavaju se lenjo, samo kad zatreba.
let companyLocationsCache = null;
const supplierProductsCache = {};
async function getSupplierProductsCached(supplierId) {
  if (!supplierProductsCache[supplierId]) supplierProductsCache[supplierId] = await getProducts(companyId, supplierId);
  return supplierProductsCache[supplierId];
}
async function getCompanyLocationsCached() {
  if (!companyLocationsCache) companyLocationsCache = await getLocations(companyId);
  return companyLocationsCache;
}

// Keš adresa lokacija preuzimanja: { [pickupLocationId]: address }. Popunjava se
// po potrebi za dobavljače koji se pojave u stavkama narudžbine (Poglavlje "Nabavke po dobavljaču").
let pickupLocationAddresses = {};
const fetchedSupplierIdsForPickup = new Set();
async function ensurePickupAddresses(itemsList) {
  const supplierIds = [...new Set(itemsList.map((i) => i.supplierId).filter(Boolean))];
  const toFetch = supplierIds.filter((sid) => !fetchedSupplierIdsForPickup.has(sid));
  if (!toFetch.length) return;
  toFetch.forEach((sid) => fetchedSupplierIdsForPickup.add(sid));
  const results = await Promise.all(toFetch.map((sid) => getSupplierLocations(companyId, sid)));
  results.forEach((locs) => locs.forEach((l) => { pickupLocationAddresses[l.id] = l.address || ""; }));
  renderAll();
}

requireAuth(null, (user, p) => {
  companyId = p.companyId; uidValue = user.uid; profile = p;
  renderNav({ companyId, uid: user.uid, profile });
  getCompanySettings(companyId).then((s) => { companySettings = s; renderAll(); });

  listenOrder(companyId, orderId, (o) => { order = o; renderAll(); });
  listenOrderItems(companyId, orderId, (i) => { items = i; renderAll(); ensurePickupAddresses(i); });
  listenOrderPurchases(companyId, orderId, (pu) => { purchases = pu; renderAll(); });
  listenDeliveryLocations(companyId, orderId, (dl) => { deliveryLocations = dl; renderAll(); });
  listenClaims(companyId, orderId, (c) => { claims = c; renderClaims(); });
  listenMessages(companyId, orderId, renderChat);
  listenAttachments(companyId, orderId, renderAttachments);

  if (getParam("confirm") === "1") {
    setTimeout(() => document.getElementById("receipt-panel")?.scrollIntoView({ behavior: "smooth" }), 600);
  }
});

// Naručilac sme ozbiljno da menja svoju narudžbinu (stavke, prioritet, lokacije
// isporuke) sve dok je nije prihvaćena — Poglavlje 2.3.
function canEditOrder() {
  return profile.role === "narucilac" && order.createdByUid === uidValue
    && [ORDER_STATUS.KREIRANA, ORDER_STATUS.CEKA_PRIHVATANJE].includes(order.status);
}

function renderAll() {
  if (!order) return;
  renderHeader();
  renderStatusTrack();
  renderActionBar();
  renderDeleteZone();
  renderItemsTable();
  renderPurchasesPanel();
  renderFinancePanel();
  renderDeliveryPanel();
  renderReceiptPanel();
  renderQrPanel();
}

// ---------------------------------------------------------------- HEADER
function renderHeader() {
  document.getElementById("order-number").textContent = order.orderNumber;
  const editable = canEditOrder();
  const priorityHtml = editable
    ? `<select id="priority-edit-select" class="priority-inline-select">
        <option value="standardno" ${order.priority !== "hitno" ? "selected" : ""}>${t("standard")}</option>
        <option value="hitno" ${order.priority === "hitno" ? "selected" : ""}>${t("urgent")}</option>
      </select>`
    : (order.priority === "hitno" ? `<span class="badge badge-urgent">${t("urgent")}</span>` : `<span class="badge badge-gray">${t("standard")}</span>`);

  // "Ko je tražio" — inline izmena dok se narudžbina još sme menjati (isti uslov
  // kao za prioritet); kad se ne sme menjati, red se uopšte ne prikazuje ako je prazan.
  const requestedByHtml = editable
    ? `<span style="display:inline-flex;align-items:center;gap:6px;">${t("requested_by_meta_label")}:
        <input type="text" id="requested-by-edit-input" class="mono" style="width:auto;min-width:160px;padding:4px 8px;font-size:13px;"
          maxlength="80" value="${escapeHtml(order.requestedByName || "")}" data-i18n-placeholder="requested_by_placeholder" placeholder="${t("requested_by_placeholder")}" /></span>`
    : (order.requestedByName ? `${t("requested_by_meta_label")}: <strong>${escapeHtml(order.requestedByName)}</strong>` : "");

  document.getElementById("order-meta").innerHTML = `
    ${t("role_narucilac")}: <strong>${escapeHtml(order.createdByName || "—")}</strong> ·
    ${t("role_isporucilac")}: <strong>${escapeHtml(order.assignedToName || t("not_assigned"))}</strong>
    ${requestedByHtml ? ` · ${requestedByHtml}` : ""} ·
    ${priorityHtml}
    <span class="badge ${badgeClassForStatus(order.status)}">${statusLabel(order.status)}</span> ·
    ${t("created_label")} ${formatDate(order.createdAt)}
    ${order.status === ORDER_STATUS.ZATVORENA && (order.closedAt || order.updatedAt) ? ` · ${t("closed_label")} ${formatDate(order.closedAt || order.updatedAt)}` : ""}
    ${editable ? `<span class="muted" style="display:block;margin-top:4px;font-size:12px;">✎ ${t("order_editable_hint")}</span>` : ""}
  `;

  document.getElementById("priority-edit-select")?.addEventListener("change", async (e) => {
    await updateOrderPriority(companyId, orderId, e.target.value, { actorUid: uidValue, actorName: profile.name });
    toast(t("toast_priority_updated"), "success");
  });

  document.getElementById("requested-by-edit-input")?.addEventListener("change", async (e) => {
    await updateOrderRequestedBy(companyId, orderId, e.target.value, { actorUid: uidValue, actorName: profile.name });
    order.requestedByName = e.target.value.trim();
    toast(t("toast_requested_by_updated"), "success");
  });
}

// ---------------------------------------------------------------- STATUS TRACK
function renderStatusTrack() {
  const flow = ORDER_STATUS_FLOW;
  const currentIdx = flow.indexOf(order.status);
  let html = flow.map((s, i) => {
    let cls = "status-step";
    if (order.status === ORDER_STATUS.REKLAMACIJA || order.status === ORDER_STATUS.ODBIJENA) {
      cls += i === 0 ? " done" : "";
    } else if (i < currentIdx) cls += " done";
    else if (i === currentIdx) cls += " current";
    return `<div class="${cls}"><div class="line"></div><div class="dot"></div><div class="step-label">${statusLabel(s)}</div></div>`;
  }).join("");
  if (order.status === ORDER_STATUS.REKLAMACIJA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">${t("status_reklamacija")}</div></div>`;
  if (order.status === ORDER_STATUS.ODBIJENA) html += `<div class="status-step current"><div class="line"></div><div class="dot"></div><div class="step-label">${t("status_odbijena")}</div></div>`;
  document.getElementById("status-track").innerHTML = html;
}

// ---------------------------------------------------------------- ACTION BAR
function renderActionBar() {
  const bar = document.getElementById("action-bar");
  bar.innerHTML = "";
  const role = profile.role;
  const S = ORDER_STATUS;

  if (role === "admin" && !order.assignedToUid && ![S.ZATVORENA, S.POTVRDJEN_PRIJEM, S.REKLAMACIJA].includes(order.status)) {
    getIsporucioci(companyId).then((list) => {
      bar.innerHTML = `
        <select id="assign-select" style="max-width:200px;">${list.map((u) => `<option value="${u.uid}" data-name="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join("") || `<option value=''>${t("no_fulfillers")}</option>`}</select>
        <button class="btn btn-amber" id="assign-btn">${t("assign_fulfiller_btn")}</button>
      `;
      document.getElementById("assign-btn")?.addEventListener("click", async () => {
        const sel = document.getElementById("assign-select");
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) return;
        await assignOrder(companyId, orderId, { assignedToUid: opt.value, assignedToName: opt.dataset.name, actorName: profile.name });
        toast(t("toast_fulfiller_assigned"), "success");
      });
    });
    return;
  }

  if (role === "isporucilac" && order.assignedToUid === uidValue) {
    if (order.status === S.CEKA_PRIHVATANJE) {
      bar.innerHTML = `<button class="btn btn-primary" id="accept-btn" data-i18n="accept">${t("accept")}</button><button class="btn btn-danger" id="reject-btn" data-i18n="reject">${t("reject")}</button>`;
      document.getElementById("accept-btn").addEventListener("click", async () => {
        await acceptOrder(companyId, orderId, { actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast(t("toast_order_accepted"), "success");
      });
      document.getElementById("reject-btn").addEventListener("click", async () => {
        const reason = prompt(t("prompt_rejection_reason"));
        if (reason === null) return;
        await rejectOrder(companyId, orderId, { reason, actorUid: uidValue, actorName: profile.name, orderCreatedByUid: order.createdByUid });
        toast(t("toast_order_rejected"), "success");
      });
    } else if (order.status === S.ZAVRSENA_NABAVKA || order.status === S.U_ISPORUCI) {
      // D+E: nema posebnih dugmadi ovde — isporuka se pokreće i završava
      // automatski kroz "Označi isporučeno" u panelu lokacija isporuke ispod.
      bar.innerHTML = `<span class="muted">${t("delivery_hint_use_panel")}</span>`;
    }
  }

  if (role === "narucilac" && order.createdByUid === uidValue && order.status === S.REKLAMACIJA) {
    bar.innerHTML = `<span class="badge badge-red">${t("claim_in_progress")}</span>`;
  }
}

// ---------------------------------------------------------------- DELETE ZONE
// Odvojeno od action-bar-a namerno: action-bar se za admina asinhrono
// prepisuje (getIsporucioci().then(...)) pa bi deljenje istog elementa
// povremeno izbrisalo dugme za brisanje. Dozvole prate firestore.rules
// (canDeleteOrder): admin sme uvek i bilo koju, naručilac samo svoju dok
// nije prihvaćena od isporučioca.
function renderDeleteZone() {
  const zone = document.getElementById("delete-zone");
  const canDelete = profile.role === "admin" || canEditOrder();
  if (!canDelete) { zone.innerHTML = ""; return; }
  zone.innerHTML = `<button class="btn btn-danger" id="delete-order-btn">🗑️ ${t("delete_order_btn")}</button>`;
  document.getElementById("delete-order-btn").addEventListener("click", async () => {
    if (!confirm(t("confirm_delete_order", { number: order.orderNumber }))) return;
    await deleteOrder(companyId, orderId, { actorUid: uidValue, actorName: profile.name, orderNumber: order.orderNumber });
    toast(t("toast_order_deleted"), "success");
    const target = profile.role === "narucilac" ? "./narucilac-dashboard.html"
      : profile.role === "admin" ? "./admin-dashboard.html" : "./isporucilac-dashboard.html";
    window.location.href = target;
  });
}

// ---------------------------------------------------------------- ITEMS TABLE
function renderItemsTable() {
  const body = document.getElementById("items-body");
  const canEdit = canEditOrder();
  if (!items.length && !canEdit) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">${t("no_items")}</td></tr>`;
    renderAddItemPanel(canEdit);
    return;
  }

  const statusBadge = (st) => ({
    na_cekanju: `<span class="badge badge-gray">${t("item_status_pending")}</span>`,
    kupljeno: `<span class="badge badge-teal">✅ ${t("item_status_purchased")}</span>`,
    nije_pronadjeno: `<span class="badge badge-red">❌ ${t("item_status_not_found")}</span>`,
    zamena: `<span class="badge badge-amber">↺ ${t("substitution")}</span>`,
  }[st] || st);

  // Kad je editovanje moguće, "Isporuka" postaje <select> sa svim trenutnim lokacijama
  // isporuke narudžbine (+ "bilo koja lokacija"), a količina i napomena postaju polja
  // za unos koja se čuvaju odmah na promenu (blur/change) — Poglavlje 2.3.
  const deliveryOptionsHtml = (selectedId) => {
    const opts = [`<option value="any" ${!selectedId || selectedId === "any" ? "selected" : ""}>${t("any_location")}</option>`]
      .concat(deliveryLocations.map((l) => `<option value="${l.id}" data-name="${escapeHtml(l.locationName)}" ${selectedId === l.id ? "selected" : ""}>${escapeHtml(l.locationName)}</option>`));
    return opts.join("");
  };

  body.innerHTML = (items.length ? items : [null]).filter(Boolean).map((i, idx) => `
    <tr data-item-id="${i.id}">
      <td class="col-num muted">${idx + 1}</td>
      <td class="mono">${escapeHtml(i.code || "—")}</td>
      <td><strong>${escapeHtml(i.productName)}</strong></td>
      <td>${escapeHtml(i.supplierName)}</td>
      <td>${i.pickupLocationId && i.pickupLocationId !== "any" ? escapeHtml(i.pickupLocationName || "—") : "—"}</td>
      <td>${canEdit
        ? `<input type="number" min="1" step="1" class="edit-item-qty mono" style="width:70px;" value="${i.quantity}" /> ${escapeHtml(i.unit)}`
        : `${i.quantity} ${escapeHtml(i.unit)}`}</td>
      <td>${canEdit
        ? `<select class="edit-item-delivery">${deliveryOptionsHtml(i.deliveryLocationId)}</select>`
        : escapeHtml(i.deliveryLocationName || "—")}</td>
      <td class="muted">${canEdit
        ? `<input type="text" class="edit-item-note" style="width:130px;" value="${escapeHtml(i.note || "")}" placeholder="${t("note")}" />`
        : escapeHtml(i.note || "—")}</td>
      <td>${statusBadge(i.purchaseStatus)} ${i.substituteName ? `<div class="muted" style="font-size:11px;">${escapeHtml(i.substituteName)}</div>` : ""}
        ${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove="${i.id}">✕ ${t("remove")}</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr class="empty-row"><td colspan="9">${t("no_items")}</td></tr>`;

  body.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteOrderItem(companyId, orderId, btn.dataset.remove);
      toast(t("toast_item_removed"), "success");
    });
  });

  if (canEdit) {
    body.querySelectorAll("tr[data-item-id]").forEach((row) => {
      const itemId = row.dataset.itemId;
      row.querySelector(".edit-item-qty")?.addEventListener("change", async (e) => {
        const qty = normalizeQuantity(e.target.value);
        e.target.value = qty;
        await updateOrderItem(companyId, orderId, itemId, { quantity: qty });
        toast(t("toast_item_updated"), "success");
      });
      row.querySelector(".edit-item-note")?.addEventListener("blur", async (e) => {
        await updateOrderItem(companyId, orderId, itemId, { note: e.target.value.trim() });
        toast(t("toast_item_updated"), "success");
      });
      row.querySelector(".edit-item-delivery")?.addEventListener("change", async (e) => {
        const opt = e.target.options[e.target.selectedIndex];
        const deliveryLocationId = opt.value;
        const deliveryLocationName = deliveryLocationId === "any" ? t("any_location") : opt.dataset.name;
        await updateOrderItem(companyId, orderId, itemId, { deliveryLocationId, deliveryLocationName });
        toast(t("toast_item_updated"), "success");
      });
    });
  }

  renderAddItemPanel(canEdit);
}

// ---------------------------------------------------------------- DODAJ ARTIKAL (dok narudžbina nije prihvaćena)
// Dozvoljeno je dodavanje samo za dobavljače koji su već deo narudžbine (imaju
// svoj red u "purchases"), jer se stavke grupišu po dobavljaču/nabavci — za
// potpuno novog dobavljača treba nova narudžbina.
function renderAddItemPanel(canEdit) {
  const host = document.getElementById("add-item-panel");
  if (!host) return;
  if (!canEdit || !purchases.length) { host.innerHTML = ""; return; }

  host.innerHTML = `
    <div class="panel-head" style="margin-top:18px;"><h3 style="margin:0;">${t("add_item_title")}</h3></div>
    <div class="form-row" style="align-items:end;">
      <div class="field"><label>${t("supplier")}</label>
        <select id="ai-supplier">${purchases.map((p) => `<option value="${p.supplierId}" data-name="${escapeHtml(p.supplierName)}">${escapeHtml(p.supplierName)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>${t("delivery_label")}</label>
        <select id="ai-delivery">${[`<option value="any">${t("any_location")}</option>`].concat(deliveryLocations.map((l) => `<option value="${l.id}" data-name="${escapeHtml(l.locationName)}">${escapeHtml(l.locationName)}</option>`)).join("")}</select>
      </div>
    </div>
    <div class="tabs" style="margin-top:10px;">
      <button type="button" class="tab-btn active" data-ai-mode="catalog">${t("tab_from_catalog")}</button>
      <button type="button" class="tab-btn" data-ai-mode="manual">${t("tab_manual_entry")}</button>
    </div>
    <div id="ai-catalog-mode">
      <div class="field" style="max-width:320px;margin-top:10px;"><label>${t("search")}</label><input type="text" id="ai-search" placeholder="${t("type_product_name_placeholder")}" /></div>
      <div class="table-wrap" style="max-height:220px;overflow:auto;">
        <table class="data-table"><tbody id="ai-product-list"></tbody></table>
      </div>
    </div>
    <div id="ai-manual-mode" class="hidden" style="margin-top:10px;">
      <div class="form-row" style="align-items:end;">
        <div class="field"><label>${t("item_name_label")}</label><input type="text" id="ai-manual-name" /></div>
        <div class="field" style="max-width:100px;"><label>${t("quantity")}</label><input type="number" id="ai-manual-qty" min="1" step="1" value="1" /></div>
        <div class="field" style="max-width:100px;"><label>${t("unit")}</label><input type="text" id="ai-manual-unit" value="kom" /></div>
      </div>
      <button type="button" class="btn btn-sm btn-amber" id="ai-manual-add-btn" style="margin-top:6px;">${t("add_to_list_btn")}</button>
    </div>
  `;

  const supplierSelect = document.getElementById("ai-supplier");
  const deliverySelect = document.getElementById("ai-delivery");
  const searchInput = document.getElementById("ai-search");
  const productListBody = document.getElementById("ai-product-list");

  async function renderProductList() {
    const supplierId = supplierSelect.value;
    const products = await getSupplierProductsCached(supplierId);
    const filtered = smartSearch(products, searchInput.value);
    if (!filtered.length) { productListBody.innerHTML = `<tr class="empty-row"><td>${t("no_products_for_query")}</td></tr>`; return; }
    productListBody.innerHTML = filtered.slice(0, 30).map((p) => `
      <tr>
        <td>${escapeHtml(p.name)} <span class="muted">(${escapeHtml(p.unit)})</span></td>
        <td style="width:90px;"><input type="number" class="ai-add-qty mono" min="1" step="1" value="1" style="width:70px;" /></td>
        <td style="width:100px;"><button type="button" class="btn btn-sm btn-amber" data-add-product="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-code="${escapeHtml(p.code || "")}">+ ${t("add")}</button></td>
      </tr>
    `).join("");
    productListBody.querySelectorAll("button[data-add-product]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const qty = normalizeQuantity(row.querySelector(".ai-add-qty").value);
        await submitNewItem({ productId: btn.dataset.addProduct, productName: btn.dataset.name, code: btn.dataset.code || "", unit: btn.dataset.unit, quantity: qty, note: "" });
      });
    });
  }

  supplierSelect.addEventListener("change", renderProductList);
  searchInput.addEventListener("input", renderProductList);
  renderProductList();

  host.querySelectorAll("button[data-ai-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      host.querySelectorAll("button[data-ai-mode]").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("ai-catalog-mode").classList.toggle("hidden", btn.dataset.aiMode !== "catalog");
      document.getElementById("ai-manual-mode").classList.toggle("hidden", btn.dataset.aiMode !== "manual");
    });
  });

  document.getElementById("ai-manual-add-btn").addEventListener("click", async () => {
    const name = document.getElementById("ai-manual-name").value.trim();
    const qty = normalizeQuantity(document.getElementById("ai-manual-qty").value);
    const unit = document.getElementById("ai-manual-unit").value.trim() || "kom";
    if (!name) { toast(t("toast_enter_item_name"), "error"); return; }
    await submitNewItem({ productId: "", productName: name, unit, quantity: qty, note: "", manualEntry: true });
    document.getElementById("ai-manual-name").value = "";
    document.getElementById("ai-manual-qty").value = 1;
  });

  async function submitNewItem({ productId, productName, code = "", unit, quantity, note, manualEntry = false }) {
    const supplierOpt = supplierSelect.options[supplierSelect.selectedIndex];
    const deliveryOpt = deliverySelect.options[deliverySelect.selectedIndex];
    await addOrderItem(companyId, orderId, {
      supplierId: supplierSelect.value, supplierName: supplierOpt.dataset.name,
      productId, productName, code, unit, quantity, note, manualEntry,
      pickupLocationId: "any", pickupLocationName: t("any_location"),
      deliveryLocationId: deliveryOpt.value, deliveryLocationName: deliveryOpt.value === "any" ? t("any_location") : deliveryOpt.dataset.name,
    });
    toast(t("toast_item_added", { name: productName }), "success");
  }
}

// ---------------------------------------------------------------- PURCHASES PANEL (Poglavlje 4.3, 5.1)
function renderPurchasesPanel() {
  const panel = document.getElementById("purchases-panel");
  if (!purchases.length) { panel.innerHTML = ""; return; }
  const canWork = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI].includes(order.status);

  // Finansijski unos je dozvoljen isporučiocu sve dok narudžbina nije prešla u fazu isporuke
  const canEditFinance = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI, ORDER_STATUS.ZAVRSENA_NABAVKA].includes(order.status);

  panel.innerHTML = `<div class="panel-head"><h2>${t("purchases_by_supplier_title")}</h2></div>` + purchases.map((p) => {
    const supplierItems = items.filter((i) => i.supplierId === p.supplierId);
    const statusBadge = { ceka: `<span class="badge badge-gray">${t("purchase_status_waiting")}</span>`, u_toku: `<span class="badge badge-amber">${t("purchase_status_in_progress")}</span>`, zavrsena: `<span class="badge badge-teal">${t("purchase_status_finished")}</span>` }[p.status];
    const showControls = canWork && p.status === "u_toku";

    // Grupisanje stavki po lokaciji preuzimanja (redosled po prvom pojavljivanju u narudžbini)
    const locGroups = [];
    const locIndex = {};
    supplierItems.forEach((i) => {
      const key = (i.pickupLocationId && i.pickupLocationId !== "any") ? i.pickupLocationId : "any";
      if (!(key in locIndex)) {
        locIndex[key] = locGroups.length;
        locGroups.push({
          name: key === "any" ? t("any_location") : (i.pickupLocationName || t("location")),
          address: key === "any" ? "" : (pickupLocationAddresses[key] || ""),
          items: [],
        });
      }
      locGroups[locIndex[key]].items.push(i);
    });

    const itemRowHtml = (i, idx) => {
      const statusLine = { kupljeno: `<div class="item-purchase-status-line st-kupljeno">✅ ${t("item_status_purchased")}</div>`, nije_pronadjeno: `<div class="item-purchase-status-line st-nije">❌ ${t("item_status_not_found")}</div>`, zamena: `<div class="item-purchase-status-line st-zamena">↺ ${t("substitution")}</div>` }[i.purchaseStatus] || "";
      return `
          <div class="item-row" data-item-id="${i.id}" style="grid-template-columns:26px 1.4fr 90px 1fr auto;">
            <div class="muted">${idx}.</div>
            <div>${i.code ? `<span class="mono muted">[${escapeHtml(i.code)}]</span> ` : ""}${escapeHtml(i.productName)} <span class="muted">(${i.quantity} ${escapeHtml(i.unit)})</span>${statusLine}</div>
            <input type="number" class="purchase-qty" value="${i.purchasedQty || i.quantity}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <input type="text" class="purchase-substitute" placeholder="${t('substitute_name_placeholder')}" value="${escapeHtml(i.substituteName || "")}" ${showControls ? "" : "disabled"} style="${showControls ? "" : "opacity:.5;"}" />
            <div style="display:flex;gap:4px;">
              ${showControls ? `
                <button class="btn btn-sm btn-outline purchase-action-btn ${i.purchaseStatus === "kupljeno" ? "is-active" : ""}" data-action="kupljeno" title="${t("item_status_purchased")}">✅</button>
                <button class="btn btn-sm btn-outline purchase-action-btn ${i.purchaseStatus === "nije_pronadjeno" ? "is-active" : ""}" data-action="nije" title="${t("item_status_not_found")}">❌</button>
                <button class="btn btn-sm btn-outline purchase-action-btn ${i.purchaseStatus === "zamena" ? "is-active" : ""}" data-action="zamena" title="${t("substitution")}">↺</button>
              ` : ""}
            </div>
          </div>`;
    };

    // Redni broj artikla kreće od 1 za SVAKOG dobavljača (nastavlja se kroz sve
    // lokacije preuzimanja tog dobavljača, ne resetuje se po lokaciji).
    let itemCounter = 0;
    const locGroupsHtml = locGroups.map((g) => `
        <div class="pickup-location-head" style="margin:12px 0 6px;padding-top:10px;border-top:1px dashed var(--line);">
          <div style="font-weight:600;">📍 ${escapeHtml(g.name)}</div>
          ${g.address ? `<div class="muted" style="font-size:12px;">${escapeHtml(g.address)}</div>` : ""}
        </div>
        ${g.items.map((i) => itemRowHtml(i, ++itemCounter)).join("")}
    `).join("");

    return `
      <div class="supplier-block">
        <div class="supplier-block-head"><h3>${escapeHtml(p.supplierName)}</h3>${statusBadge}</div>
        ${locGroupsHtml}
        <div class="form-row payment-form" data-purchase="${p.id}" style="margin-top:12px;align-items:end;">
          <div class="field"><label>${t("paid_amount_label")} (${companyCurrency()})</label><input type="number" step="0.01" min="0" class="pay-amount" value="${p.paidAmount ?? ""}" placeholder="0.00" ${canEditFinance ? "" : "disabled"} /></div>
          <div class="field"><label>${t("receipt_number_label")}</label><input type="text" class="pay-receipt-number" value="${escapeHtml(p.receiptNumber || "")}" ${canEditFinance ? "" : "disabled"} /></div>
          <div class="field"><label>${t("receipt_date_label")}</label><input type="text" class="js-datepicker pay-receipt-date" data-value="${escapeHtml(p.receiptDate || "")}" ${canEditFinance ? "" : "disabled"} /></div>
          ${canEditFinance ? `<button type="button" class="btn btn-sm btn-primary" data-save-payment="${p.id}">💾 ${t("save")}</button>` : ""}
        </div>
        ${!canEditFinance && (p.paidAmount || p.receiptNumber) ? `<p class="muted" style="margin-top:4px;">${t("paid_label")}: <strong>${formatCurrency(p.paidAmount)}</strong>${p.receiptNumber ? ` · ${t("receipt_no_short")} ${escapeHtml(p.receiptNumber)}` : ""}${p.receiptDate ? ` ${t("from_date_prefix")} ${formatDateShort2(p.receiptDate)}` : ""}</p>` : ""}
      </div>
    `;
  }).join("");

  initDatepickers(panel);

  panel.querySelectorAll("button[data-save-payment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = panel.querySelector(`.payment-form[data-purchase="${btn.dataset.savePayment}"]`);
      const paidAmount = Number(row.querySelector(".pay-amount").value) || 0;
      const receiptNumber = row.querySelector(".pay-receipt-number").value.trim();
      const receiptDate = getISO(row.querySelector(".pay-receipt-date"));
      await setPurchasePayment(companyId, orderId, btn.dataset.savePayment, { paidAmount, receiptNumber, receiptDate }, profile.name);
      toast(t("toast_finance_saved"), "success");
    });
  });
  panel.querySelectorAll(".item-row[data-item-id] button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".item-row");
      const itemId = row.dataset.itemId;
      const qty = Number(row.querySelector(".purchase-qty").value) || 0;
      const substitute = row.querySelector(".purchase-substitute").value.trim();
      if (btn.dataset.action === "kupljeno") await markItemPurchased(companyId, orderId, itemId, { purchasedQty: qty, substituteName: "" });
      if (btn.dataset.action === "nije") await markItemNotFound(companyId, orderId, itemId);
      if (btn.dataset.action === "zamena") await markItemSubstitute(companyId, orderId, itemId, { purchasedQty: qty, substituteName: substitute || t("substitution") });

      // B: auto-završavanje nabavke po dobavljaču kad su sve njegove stavke obrađene
      // (nema više posebnog dugmeta "Završi ovu nabavku") — a kad su i svi ostali
      // dobavljači gotovi, cela narudžbina automatski prelazi u "zavrsena_nabavka".
      const item = items.find((i) => i.id === itemId);
      const purchase = item && purchases.find((p) => p.supplierId === item.supplierId);
      const supplierItemsDone = item && items
        .filter((i) => i.supplierId === item.supplierId)
        .every((i) => i.id === itemId || i.purchaseStatus !== "na_cekanju");

      if (purchase && purchase.status !== "zavrsena" && supplierItemsDone) {
        await finishPurchase(companyId, orderId, purchase.id, profile.name);
        const stillOpen = purchases.some((p) => p.id !== purchase.id && p.status !== "zavrsena");
        if (!stillOpen) {
          await setOrderStatus(companyId, orderId, ORDER_STATUS.ZAVRSENA_NABAVKA, { actorUid: uidValue, actorName: profile.name });
          toast(t("toast_all_purchases_finished"), "success");
        } else {
          toast(t("toast_purchase_finished_for_supplier"), "success");
        }
        return;
      }
      toast(t("toast_updated"), "success");
    });
  });
}

// ---------------------------------------------------------------- FINANCE PANEL (finansijski pregled narudžbine)
function renderFinancePanel() {
  const panel = document.getElementById("finance-panel");
  if (!purchases.length) { panel.innerHTML = ""; return; }
  const total = calcOrderTotal(purchases);
  const isClosed = [ORDER_STATUS.ZATVORENA, ORDER_STATUS.POTVRDJEN_PRIJEM].includes(order.status);
  if (total === 0 && !isClosed) { panel.innerHTML = ""; return; }

  panel.innerHTML = `
    <div class="panel-head"><h2>${t("finance_overview_title")}</h2>${isClosed ? `<span class="badge badge-green">${t("order_closed_badge")}</span>` : ""}</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${t("supplier")}</th><th>${t("receipt_number_label")}</th><th>${t("receipt_date_label")}</th><th>${t("amount_label")}</th></tr></thead>
        <tbody>
          ${purchases.map((p) => `
            <tr>
              <td>${escapeHtml(p.supplierName)}</td>
              <td>${escapeHtml(p.receiptNumber || "—")}</td>
              <td>${p.receiptDate ? formatDateShort2(p.receiptDate) : "—"}</td>
              <td class="mono">${formatCurrency(p.paidAmount)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr><td colspan="3" style="text-align:right;"><strong>${t("order_total_label")}:</strong></td><td class="mono"><strong>${formatCurrency(total)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
  `;
}

function companyCurrency() { return companySettings?.currency || "RSD"; }
function formatCurrency(amount) {
  const n = Number(amount) || 0;
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${companyCurrency()}`;
}
// Formatira datum u formatu YYYY-MM-DD (iz <input type="date">) u sr-RS prikaz — formatDateShort iz utils.js očekuje Firestore Timestamp
function formatDateShort2(isoDateStr) {
  if (!isoDateStr) return "—";
  const d = new Date(isoDateStr + "T00:00:00");
  if (isNaN(d)) return isoDateStr;
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------------------------------------------------------------- DELIVERY PANEL (Poglavlje 5.2)
function renderDeliveryPanel() {
  const panel = document.getElementById("delivery-panel");
  const canEdit = canEditOrder();
  if (!deliveryLocations.length && !canEdit) { panel.innerHTML = ""; return; }
  // D: isporučilac može da počne da označava lokacije kao isporučene čim je
  // nabavka gotova (zavrsena_nabavka), bez posebnog "Pokreni isporuku" klika —
  // prvi klik na "Označi isporučeno" sam prebacuje narudžbinu u u_isporuci.
  const isDeliverer = profile.role === "isporucilac" && order.assignedToUid === uidValue
    && [ORDER_STATUS.ZAVRSENA_NABAVKA, ORDER_STATUS.U_ISPORUCI].includes(order.status);

  const statusBadge = { ceka: `<span class="badge badge-gray">${t("delivery_status_waiting")}</span>`, isporuceno: `<span class="badge badge-amber">${t("delivery_status_delivered")}</span>`, potvrdjeno: `<span class="badge badge-teal">${t("delivery_status_confirmed")}</span>` };

  // Lokacija se sme ukloniti samo ako nijedan artikal trenutno ne ide na nju —
  // u suprotnom bi ostala "siroče" referenca u stavkama (Poglavlje 2.3).
  const rowsHtml = deliveryLocations.map((l) => {
    const inUse = items.some((i) => i.deliveryLocationId === l.id);
    return `
    <div class="item-row" data-loc-id="${l.id}" style="grid-template-columns:1.6fr 1fr auto;">
      <div><strong>${escapeHtml(l.locationName)}</strong></div>
      <div>${statusBadge[l.status]}</div>
      <div>
        ${isDeliverer && l.status === "ceka" ? `<button class="btn btn-sm btn-amber" data-deliver="${l.id}">${t("mark_delivered_btn")}</button>` : ""}
        ${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove-loc="${l.id}" ${inUse ? "disabled title=\"" + escapeHtml(t("location_in_use_hint")) + "\"" : ""}>✕ ${t("remove")}</button>` : ""}
      </div>
    </div>`;
  }).join("");

  const addLocHtml = canEdit ? `<div id="add-delivery-location-row" class="form-row" style="align-items:end;margin-top:12px;">
      <div class="field" style="max-width:260px;"><label>${t("add_delivery_location_label")}</label><select id="new-delivery-loc"></select></div>
      <button type="button" class="btn btn-sm btn-amber" id="add-delivery-loc-btn">+ ${t("add")}</button>
    </div>` : "";

  panel.innerHTML = `<div class="panel-head"><h2>${t("delivery_locations_title")}</h2></div>${rowsHtml}${addLocHtml}`;

  panel.querySelectorAll("button[data-deliver]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const locId = btn.dataset.deliver;
      await markLocationDelivered(companyId, orderId, locId, profile.name);

      // D: prvi klik na "Označi isporučeno" ujedno pokreće isporuku ako još nije pokrenuta
      if (order.status === ORDER_STATUS.ZAVRSENA_NABAVKA) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.U_ISPORUCI, { actorUid: uidValue, actorName: profile.name });
      }

      // E: kad je i poslednja preostala lokacija označena, isporuka se automatski završava
      const stillWaiting = deliveryLocations.some((l) => l.id !== locId && l.status === "ceka");
      if (!stillWaiting) {
        await setOrderStatus(companyId, orderId, ORDER_STATUS.ISPORUCENA, { actorUid: uidValue, actorName: profile.name });
        toast(t("toast_goods_delivered"), "success");
      }
    });
  });
  panel.querySelectorAll("button[data-remove-loc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await removeOrderDeliveryLocation(companyId, orderId, btn.dataset.removeLoc);
      toast(t("toast_location_removed_from_order"), "success");
    });
  });

  if (canEdit) {
    getCompanyLocationsCached().then((companyLocs) => {
      const sel = document.getElementById("new-delivery-loc");
      if (!sel) return;
      const alreadyAdded = new Set(deliveryLocations.map((l) => l.locationId));
      const available = companyLocs.filter((l) => !alreadyAdded.has(l.id));
      if (!available.length) {
        sel.innerHTML = `<option value="">${t("no_more_locations_to_add")}</option>`;
        document.getElementById("add-delivery-loc-btn").disabled = true;
        return;
      }
      sel.innerHTML = available.map((l) => `<option value="${l.id}" data-name="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join("");
      document.getElementById("add-delivery-loc-btn").addEventListener("click", async () => {
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) return;
        await addOrderDeliveryLocation(companyId, orderId, { locationId: opt.value, locationName: opt.dataset.name });
        toast(t("toast_location_added_to_order"), "success");
      });
    });
  }
}

// ---------------------------------------------------------------- RECEIPT PANEL (Poglavlje 6)
function renderReceiptPanel() {
  const panel = document.getElementById("receipt-panel");
  const isOrderer = profile.role === "narucilac" && order.createdByUid === uidValue;
  if (!isOrderer || order.status !== ORDER_STATUS.ISPORUCENA) { panel.innerHTML = ""; return; }

  panel.innerHTML = `
    <div class="panel-head"><h2 data-i18n="confirm_receipt">${t("confirm_receipt")}</h2></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${t("item_label")}</th><th data-i18n="requested">${t("requested")}</th><th data-i18n="received">${t("received")}</th></tr></thead>
        <tbody>
          ${items.map((i) => `
            <tr data-item-id="${i.id}" data-product="${escapeHtml(i.productName)}" data-supplier="${escapeHtml(i.supplierId)}" data-supplier-name="${escapeHtml(i.supplierName)}" data-unit="${escapeHtml(i.unit)}" data-requested="${i.quantity}">
              <td>${escapeHtml(i.productName)}</td>
              <td>${i.quantity} ${escapeHtml(i.unit)}</td>
              <td><input type="number" class="received-qty" value="${i.purchaseStatus === "nije_pronadjeno" ? 0 : (i.purchasedQty || i.quantity)}" style="width:90px;" /></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button class="btn btn-primary" id="confirm-receipt-btn" data-i18n="confirm_receipt">${t("confirm_receipt")}</button>
      <button class="btn btn-danger" id="open-claim-btn" data-i18n="open_claim">${t("open_claim")}</button>
    </div>
  `;

  document.getElementById("confirm-receipt-btn").addEventListener("click", async () => {
    const rows = Array.from(panel.querySelectorAll("tbody tr"));
    const missing = rows.filter((r) => Number(r.querySelector(".received-qty").value) < Number(r.dataset.requested));
    let carryOver = [];
    if (missing.length) {
      const wantsCarryOver = confirm(t("confirm_carry_over_missing", { count: missing.length }));
      if (wantsCarryOver) {
        carryOver = missing.map((r) => ({
          supplierId: r.dataset.supplier, supplierName: r.dataset.supplierName,
          productId: "", productName: r.dataset.product, unit: r.dataset.unit,
          quantity: Number(r.dataset.requested) - Number(r.querySelector(".received-qty").value),
          note: t("auto_carried_over_note"), priority: order.priority,
          pickupLocationId: "any", pickupLocationName: t("any_location"),
        }));
      }
    }
    await confirmReceipt(companyId, orderId, { actorUid: uidValue, actorName: profile.name, missingItemsToCarryOver: carryOver });
    await Promise.all(deliveryLocations.map((l) => confirmLocationReceipt(companyId, orderId, l.id, profile.name)));
    toast(t("toast_receipt_confirmed_closed"), "success");
  });

  document.getElementById("open-claim-btn").addEventListener("click", () => {
    const claimSelect = document.getElementById("claim-item");
    claimSelect.innerHTML = items.map((i) =>
      `<option value="${escapeHtml(i.productName)}" data-qty="${i.quantity}">${escapeHtml(i.productName)} (${i.quantity} ${escapeHtml(i.unit)})</option>`
    ).join("");
    if (claimSelect.options.length) {
      document.getElementById("claim-requested").value = claimSelect.options[0].dataset.qty || "";
    }
    document.getElementById("claim-modal").classList.remove("hidden");
  });
}

// ---------------------------------------------------------------- CLAIMS PANEL (Poglavlje 6)
function renderClaims() {
  const panel = document.getElementById("claims-panel");
  if (!claims.length) { panel.innerHTML = ""; return; }
  const canResolve = profile.role === "admin" || (profile.role === "isporucilac" && order?.assignedToUid === uidValue);

  panel.innerHTML = `<div class="panel-head"><h2>${t("claims_title")}</h2></div>` + claims.map((c) => `
    <div class="supplier-block">
      <div class="supplier-block-head">
        <h3>${escapeHtml(c.itemName)}</h3>
        <span class="badge ${c.status === "otvorena" ? "badge-red" : "badge-teal"}">${c.status === "otvorena" ? t("claim_status_open") : t("status_zatvorena")}</span>
      </div>
      <p>${t("requested")}: ${c.requestedQty} · ${t("received")}: ${c.receivedQty}</p>
      <p class="muted">${escapeHtml(c.description || "")}</p>
      ${c.resolutionNote ? `<p><strong>${t("resolution_label")}:</strong> ${escapeHtml(c.resolutionNote)}</p>` : ""}
      ${canResolve && c.status === "otvorena" ? `<button class="btn btn-sm btn-primary" data-resolve="${c.id}">${t("close_claim_btn")}</button>` : ""}
    </div>
  `).join("");

  panel.querySelectorAll("button[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = prompt(t("prompt_claim_resolution_note")) || "";
      await resolveClaim(companyId, orderId, btn.dataset.resolve, { resolutionNote: note, actorName: profile.name });
      toast(t("toast_claim_closed"), "success");
    });
  });
}

document.getElementById("close-claim-modal").addEventListener("click", () => document.getElementById("claim-modal").classList.add("hidden"));
document.getElementById("claim-item").addEventListener("change", (e) => {
  const opt = e.target.options[e.target.selectedIndex];
  document.getElementById("claim-requested").value = opt?.dataset.qty || "";
});

document.getElementById("claim-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await openClaim(companyId, orderId, {
    itemName: document.getElementById("claim-item").value.trim(),
    requestedQty: Number(document.getElementById("claim-requested").value),
    receivedQty: Number(document.getElementById("claim-received").value),
    description: document.getElementById("claim-desc").value.trim(),
    actorUid: uidValue, actorName: profile.name, notifyUid: order.assignedToUid,
  });
  toast(t("toast_claim_opened"), "success");
  document.getElementById("claim-modal").classList.add("hidden");
  e.target.reset();
});

// ---------------------------------------------------------------- QR PANEL (Poglavlje 11.1)
async function renderQrPanel() {
  const panel = document.getElementById("qr-panel");
  panel.innerHTML = `<div class="panel-head"><h2 data-i18n="qr_code">${t("qr_code")}</h2></div><div class="qr-box"><div id="qr-canvas"></div><p class="muted" style="text-align:center;">${t("qr_scan_hint")}</p></div>`;
  await renderQrCode(document.getElementById("qr-canvas"), orderQrUrl(companyId, orderId));
}

// ---------------------------------------------------------------- CHAT (Poglavlje 2.2-2.4)
function renderChat(messages) {
  const host = document.getElementById("chat-messages");
  host.innerHTML = messages.length
    ? messages.map((m) => `<div class="chat-msg ${m.fromUid === uidValue ? "mine" : ""}">${escapeHtml(m.text)}<span class="meta">${escapeHtml(m.fromName)} · ${formatDate(m.createdAt)}</span></div>`).join("")
    : `<p class="muted">${t("no_messages_yet")}</p>`;
  host.scrollTop = host.scrollHeight;
}
document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !order) return;
  const toUid = uidValue === order.createdByUid ? order.assignedToUid : order.createdByUid;
  await sendMessageAndNotify(companyId, orderId, { fromUid: uidValue, fromName: profile.name, text, toUid });
  input.value = "";
});

// ---------------------------------------------------------------- ATTACHMENTS (Poglavlje 11)
function renderAttachments(list) {
  const host = document.getElementById("attachments-list");
  host.innerHTML = list.length
    ? list.map((a) => `
      <div class="attachment-item">
        <a href="${a.url}" target="_blank" rel="noopener">${a.type === "racun" ? "🧾" : "📷"} ${escapeHtml(a.fileName)}</a>
        ${a.receiptNumber ? `<span class="muted">· ${t("receipt_hash")} ${escapeHtml(a.receiptNumber)}</span>` : ""}
        <span class="muted" style="margin-left:auto;">${escapeHtml(a.uploadedByName || "")}</span>
      </div>`).join("")
    : `<p class="muted">${t("no_attachments")}</p>`;
}
// ---------------------------------------------------------------- PDF NARUDŽBENICA (štampa/izvoz)
document.getElementById("print-pdf-btn").addEventListener("click", async (e) => {
  if (!order) return;
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = t("generating_pdf_ellipsis");
  try {
    await generateOrderPdf({ company: companySettings, order, items, purchases, deliveryLocations, companyId });
  } catch (err) {
    console.error(err);
    toast(t("toast_pdf_generate_error"), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById("upload-btn").addEventListener("click", async () => {
  const file = document.getElementById("attachment-file").files[0];
  if (!file) { toast(t("toast_select_file"), "error"); return; }
  const type = document.getElementById("attachment-type").value;
  const receiptNumber = document.getElementById("receipt-number").value.trim();
  try {
    await uploadAttachment(companyId, orderId, file, { type, uploadedByUid: uidValue, uploadedByName: profile.name, receiptNumber });
    toast(t("toast_attachment_uploaded"), "success");
    document.getElementById("attachment-file").value = "";
  } catch (err) {
    console.error(err);
    toast(t("toast_upload_error"), "error");
  }
});
