// ============================================================================
// ROUTE-PLANNER — prozor „🧭 Predloži rutu": sakupi stanice iz aktivnih narudžbina
// (prvo sva preuzimanja kod dobavljača, pa sve isporuke), izračunaj najkraći
// redosled lokalno (vazdušna linija × 1,3, bez spoljnih servisa), dozvoli ručnu
// izmenu redosleda i otvori rutu u Google Maps sa ubačenim stanicama.
// Poziva se sa: kartice narudžbine (jedna narudžbina) i sa kontrolnih tabli
// isporučioca/naručioca (sve njihove aktivne narudžbine).
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml, statusLabel, toast } from "./utils.js";
import { listenOpenOrdersBy, getOrder, getOrderItems, getOrderDeliveryLocations } from "./orders.js";
import { getSuppliers, getSupplierLocations } from "./suppliers.js";
import { getLocations } from "./locations.js";
import {
  buildStops, planRoute, routeMeters, moveStop, stopsToPoints, buildGoogleMapsUrls, fmtKm, hasCoords, mapsPointUrl,
} from "./geo.js";

function getOpenOrdersOnce(companyId, field, value) {
  return new Promise((resolve, reject) => {
    let unsub = null, done = false;
    unsub = listenOpenOrdersBy(companyId, field, value, (orders) => {
      if (done) return;
      done = true; setTimeout(() => unsub?.(), 0); resolve(orders);
    }, reject);
  });
}

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 120000 },
    );
  });
}

// opts: { companyId, orderId } (jedna narudžbina) ILI { companyId, ownerField, ownerUid } (sve aktivne od tog korisnika)
export async function openRoutePlanner({ companyId, orderId = null, ownerField = null, ownerUid = null }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card wide" style="max-width:720px;">
      <div class="modal-head"><h2>🧭 ${t("route_title")}</h2><button type="button" class="icon-btn" data-act="close">✕</button></div>
      <div data-r="body"><p class="muted">${t("route_loading")}</p></div>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('[data-r="body"]');
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-act=close]")) close(); });

  let orders = [], suppliersById = {}, supplierLocsById = {}, companyLocs = [], companyLocsById = {};
  try {
    const [base, sups, locs, gps] = await Promise.all([
      orderId ? getOrder(companyId, orderId).then((o) => (o ? [{ ...o, id: orderId }] : [])) : getOpenOrdersOnce(companyId, ownerField, ownerUid),
      getSuppliers(companyId), getLocations(companyId), currentPosition(),
    ]);
    state.gps = gps;
    companyLocs = locs; locs.forEach((l) => { companyLocsById[l.id] = l; });
    sups.forEach((s) => { suppliersById[s.id] = s; });
    orders = await Promise.all(base.map(async (o) => ({
      ...o,
      items: await getOrderItems(companyId, o.id),
      deliveryLocations: await getOrderDeliveryLocations(companyId, o.id),
    })));
    const supIds = [...new Set(orders.flatMap((o) => [...o.items.map((i) => i.supplierId), ...o.deliveryLocations.map((d) => d.supplierId)]).filter(Boolean))];
    await Promise.all(supIds.map(async (id) => { supplierLocsById[id] = await getSupplierLocations(companyId, id); }));
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="muted">${escapeHtml(err.message || String(err))}</p>`;
    return;
  }

  orders.sort((a, b) => String(a.orderNumber).localeCompare(String(b.orderNumber)));
  const selected = new Set(orders.map((o) => o.id));   // sve unapred štiklirane
  let startChoice = "gps";                              // "gps" | id lokacije firme
  let seq = [];

  const startPoint = () => {
    if (startChoice === "gps") return state.gps;        // može biti null (odbijena lokacija)
    const l = companyLocsById[startChoice];
    return l && hasCoords(l) ? { lat: Number(l.lat), lng: Number(l.lng) } : null;
  };

  function recompute() {
    const { pickups, deliveries } = buildStops({
      orders: orders.filter((o) => selected.has(o.id)), suppliersById, supplierLocsById, companyLocsById,
    });
    seq = planRoute({ start: startPoint(), pickups, deliveries });
    render();
  }

  function stopLine(s, i) {
    const ords = s.orders.map((o) => (s.kind === "pickup" ? `${escapeHtml(o.orderNumber)} (${o.count})` : escapeHtml(o.orderNumber))).join(", ");
    const sameKindBefore = i > 0 && seq[i - 1].kind === s.kind, sameKindAfter = i < seq.length - 1 && seq[i + 1].kind === s.kind;
    return `
      <div class="attachment-item" style="align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <span style="min-width:22px;font-weight:700;">${i + 1}</span>
        <div style="flex:1;min-width:180px;">
          <div>${s.kind === "pickup" ? "📍" : "🏬"} <strong>${escapeHtml(s.name)}</strong></div>
          <div class="muted" style="font-size:12px;">${s.kind === "delivery" ? `${t("route_delivery_note")}: ` : ""}${ords}</div>
          ${s.hasCoords ? "" : `<div style="font-size:12px;color:var(--color-warning,#b45309);">⚠ ${t("route_no_coords")}${s.address ? ` — ${escapeHtml(s.address)}` : ""}</div>`}
        </div>
        <div class="row-actions" style="gap:4px;">
          <button type="button" class="btn btn-sm btn-outline" data-up="${i}" ${sameKindBefore ? "" : "disabled"} title="${t("route_move_up")}">↑</button>
          <button type="button" class="btn btn-sm btn-outline" data-down="${i}" ${sameKindAfter ? "" : "disabled"} title="${t("route_move_down")}">↓</button>
        </div>
      </div>`;
  }

  function render() {
    const sp = startPoint();
    const links = seq.length ? buildGoogleMapsUrls({ origin: sp && startChoice !== "gps" ? sp : null, ordered: stopsToPoints(seq) }) : [];
    const meters = routeMeters(sp, seq);
    const missing = seq.filter((s) => !s.hasCoords).length;
    body.innerHTML = `
      <div class="field"><label>${t("route_orders")}</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;">
          ${orders.length ? orders.map((o) => `<label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" data-ord="${o.id}" ${selected.has(o.id) ? "checked" : ""}/> <span class="mono">${escapeHtml(o.orderNumber)}</span> <span class="muted">${escapeHtml(statusLabel(o.status))}</span></label>`).join("") : `<span class="muted">${t("route_no_orders")}</span>`}
        </div></div>
      <div class="field"><label>${t("route_start")}</label>
        <select data-r="start">
          <option value="gps" ${startChoice === "gps" ? "selected" : ""}>${t("route_start_gps")}${state.gps ? "" : ` (${t("route_gps_unavailable")})`}</option>
          ${companyLocs.map((l) => `<option value="${l.id}" ${startChoice === l.id ? "selected" : ""} ${hasCoords(l) ? "" : "disabled"}>${escapeHtml(l.name)}${hasCoords(l) ? "" : ` — ${t("geo_no_coords")}`}</option>`).join("")}
        </select></div>
      ${seq.length ? `
        <div style="margin-bottom:10px;">${seq.map(stopLine).join("")}</div>
        <p class="muted" style="font-size:12px;">${t("route_note")}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0;">
          <strong>${t("route_approx")}: ${meters ? fmtKm(meters) : "—"}${missing ? ` <span class="muted" style="font-weight:400;">(${t("route_missing_n", { n: missing })})</span>` : ""}</strong>
          <button type="button" class="btn btn-sm btn-outline" data-r="reopt">${t("route_reoptimize")}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${links.map((l, i) => `<a class="btn btn-primary" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">🗺 ${t("route_open_gmaps")}${links.length > 1 ? ` — ${t("route_part", { i: i + 1, n: links.length })}` : ""}</a>`).join("")}
          <button type="button" class="btn btn-outline" data-r="copy">${t("route_copy_link")}</button>
        </div>`
        : `<p class="muted">${t("route_no_stops")}</p>`}`;

    body.querySelectorAll("[data-ord]").forEach((c) => c.addEventListener("change", () => { c.checked ? selected.add(c.dataset.ord) : selected.delete(c.dataset.ord); recompute(); }));
    body.querySelector('[data-r="start"]').addEventListener("change", (e) => { startChoice = e.target.value; recompute(); });
    body.querySelector('[data-r="reopt"]')?.addEventListener("click", recompute);
    body.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => { seq = moveStop(seq, Number(b.dataset.up), -1); render(); }));
    body.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => { seq = moveStop(seq, Number(b.dataset.down), 1); render(); }));
    body.querySelector('[data-r="copy"]')?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(links.map((l) => l.url).join("\n")); toast(t("route_copied"), "success"); }
      catch { window.prompt(t("route_copy_link"), links.map((l) => l.url).join("\n")); }
    });
  }

  recompute();
}
const state = { gps: null };
