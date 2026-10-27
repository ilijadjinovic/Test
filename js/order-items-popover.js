// ============================================================================
// ORDER-ITEMS-POPOVER — balon sa listom artikala kad se mišem pređe preko broja
// narudžbenice u tabeli (kontrolne table Naručioca, Isporučioca i Admina).
// Artikli se čitaju tek pri prvom prelasku (jedno čitanje po narudžbini) i pamte u
// memoriji; dok je čitanje u toku, balon pokazuje "Učitavanje...". Radi preko jednog
// delegiranog slušaoca na telu tabele, pa preživljava ponovno iscrtavanje redova.
// ============================================================================
import { t } from "./i18n.js";
import { escapeHtml } from "./utils.js";
import { getOrderItems } from "./orders.js";

const SHOW_DELAY_MS = 180;   // mali odmak da balon ne bljesne dok miš samo prolazi preko tabele
const MAX_ITEMS = 12;
const touchOnly = () => window.matchMedia("(hover: none)").matches; // telefon/tablet: bez hovera, balon se otvara dodirom na ikonicu
const cache = new Map();     // orderId -> Promise<items[]>

let pop = null;
function ensurePop() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.className = "items-pop";
  pop.setAttribute("role", "tooltip");
  document.body.appendChild(pop);
  return pop;
}

// Ikonica (i) pored broja narudžbenice — vidljiva samo na ekranima na dodir (vidi CSS)
export const itemsInfoBtnHtml = () =>
  `<button type="button" class="items-info-btn" data-items-btn aria-label="${escapeHtml(t("items_pop_label"))}">i</button>`;

function fmtQty(it) {
  const q = it.quantity ?? "";
  return `${q}${it.unit ? ` ${it.unit}` : ""}`.trim();
}

const ICON_USER = `<svg class="items-pop-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>`;
const ICON_TRUCK = `<svg class="items-pop-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>`;

// Jedinstveni dobavljači iz SVIH stavki narudžbine (ne samo prvih MAX_ITEMS), redosled prvog pojavljivanja
function supplierNames(items) {
  const seen = new Set();
  (items || []).forEach((it) => { const n = (it.supplierName || "").trim(); if (n) seen.add(n); });
  return [...seen];
}

function contentHtml(order, items) {
  // Zaglavlje: red 1 = broj narudžbenice; red 2 = ime osobe (ako je uneto) · dobavljači.
  // Dugačka lista dobavljača se lomi u najviše dva reda (CSS), ostatak se skraćuje tri tačke.
  const by = (order?.requestedByName || "").trim();
  const sup = supplierNames(items);
  const byHtml = by ? `<span class="items-pop-by">${ICON_USER}<strong>${escapeHtml(by)}</strong></span>` : "";
  const supHtml = sup.length ? `<span class="items-pop-sup" title="${escapeHtml(t("items_pop_suppliers"))}">${ICON_TRUCK}<span class="items-pop-sup-text">${escapeHtml(sup.join(", "))}</span></span>` : "";
  const meta = (byHtml || supHtml) ? `<div class="items-pop-meta">${byHtml}${byHtml && supHtml ? '<span class="items-pop-dot">·</span>' : ""}${supHtml}</div>` : "";
  const head = `<div class="items-pop-head"><span class="items-pop-num">${escapeHtml(order?.orderNumber || "")}</span></div>${meta}`;
  if (items === null) return `${head}<div class="items-pop-empty">${t("loading_ellipsis")}</div>`;
  if (!items.length) return `${head}<div class="items-pop-empty">${t("items_pop_empty")}</div>`;
  const rows = items.slice(0, MAX_ITEMS).map((it) => `
    <li><span class="items-pop-name">${escapeHtml(it.productName || "—")}</span><span class="items-pop-qty">${escapeHtml(fmtQty(it))}</span></li>`).join("");
  const more = items.length > MAX_ITEMS ? `<div class="items-pop-more">${t("items_pop_more", { count: items.length - MAX_ITEMS })}</div>` : "";
  return `${head}<ul class="items-pop-list">${rows}</ul>${more}`;
}

function position(anchor) {
  const p = ensurePop();
  const r = anchor.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight, gap = 8;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - gap); // nema mesta ispod → iznad
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

// body: <tbody> tabele; getOrder(id) vraća narudžbinu iz liste (za broj u naslovu balona)
export function attachOrderItemsPopover(body, { companyId, getOrder }) {
  if (!body || body.dataset.itemsPop) return;
  body.dataset.itemsPop = "1";
  let timer = null, hideTimer = null, current = null;   // current = { anchor, id }

  const hide = () => {
    clearTimeout(timer); clearTimeout(hideTimer); timer = hideTimer = null; current = null;
    if (pop) pop.classList.remove("show");
  };

  const show = async (anchor, id) => {
    const order = getOrder?.(id) || { orderNumber: "" };
    const p = ensurePop();
    const cached = cache.has(id);
    p.innerHTML = contentHtml(order, cached ? await cache.get(id).catch(() => []) : null);
    p.classList.add("show");
    position(anchor);
    if (cached) return;
    const promise = getOrderItems(companyId, id).catch((err) => { console.error("Artikli narudžbine:", err); cache.delete(id); return []; });
    cache.set(id, promise);
    const items = await promise;
    if (current?.id !== id || !anchor.isConnected) return; // miš je u međuvremenu otišao na drugu narudžbinu
    p.innerHTML = contentHtml(order, items);
    position(anchor);
  };

  body.addEventListener("mouseover", (e) => {
    if (touchOnly()) return;
    const cell = e.target.closest("tr.row-link > td:first-child");
    if (!cell || !body.contains(cell)) return;
    const id = cell.parentElement.dataset.id;
    clearTimeout(hideTimer);   // prelazak na sledeću narudžbinu: balon ostaje otvoren i samo menja sadržaj
    if (current?.anchor === cell) return;
    clearTimeout(timer);
    current = { anchor: cell, id };
    // Ako je balon već otvoren (prelazak sa jedne narudžbine na drugu), menja se odmah
    timer = setTimeout(() => show(cell, id), pop?.classList.contains("show") ? 0 : SHOW_DELAY_MS);
  });
  body.addEventListener("mouseout", (e) => {
    if (touchOnly()) return;
    const cell = e.target.closest("tr.row-link > td:first-child");
    if (!cell || cell.contains(e.relatedTarget)) return;
    if (current?.anchor !== cell) return;
    clearTimeout(timer); current = null;
    hideTimer = setTimeout(hide, 80);
  });
  // Telefon: dodir na ikonicu otvara/zatvara balon; dodir bilo gde drugde, skrol i promena prozora ga zatvaraju
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-items-btn]");
    if (!btn) { hide(); return; }
    const cell = btn.closest("td");
    const id = btn.closest("tr")?.dataset.id;
    if (!cell || !id) return;
    if (current?.anchor === cell && pop?.classList.contains("show")) { hide(); return; }
    clearTimeout(timer); clearTimeout(hideTimer);
    current = { anchor: cell, id };
    show(cell, id);
  });
  document.addEventListener("click", (e) => { if (!body.contains(e.target)) hide(); });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}
