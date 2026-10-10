// ============================================================================
// DASH-LOGIC — čista logika kontrolnih tabli (bez Firebase-a i bez DOM-a),
// da može da se testira u Node-u (vidi tests/dash-logic.test.mjs).
//   • pravilo "kasne" (hitne > 2h, standardne > 24h, od trenutka dodele)
//   • normalizacija teksta i poklapanje pretrage (deo reči, bez dijakritika)
//   • polja za pretragu koja se upisuju na narudžbinu (searchText...)
//   • sortiranje redova po ulozi
// ============================================================================

export const PAGE_SIZE = 25;       // broj redova po "strani" (dugme "Učitaj još")
export const RECENT_DAYS = 30;     // zatvorene/odbijene starije od toga nestaju sa liste
export const SEARCH_CAP = 5000;    // gornja granica pri pretrazi cele istorije
export const SEARCH_CACHE_MS = 5 * 60 * 1000;
export const LATE_LIMIT_HOURS = { hitno: 2, standardno: 24 };
export const TZ = "Europe/Belgrade";

// Isti string-ovi kao u utils.js (ORDER_STATUS) — ovde su ponovljeni namerno
// da ovaj fajl nema nikakvih uvoza.
export const OPEN_STATUSES = [
  "kreirana", "ceka_prihvatanje", "prihvacena", "u_nabavci", "zavrsena_nabavka",
  "u_isporuci", "isporucena", "potvrdjen_prijem", "reklamacija",
];
export const CLOSED_STATUSES = ["zatvorena", "odbijena"];
// Statusi u kojima narudžbina NE može da "kasni": isporučena čeka naručioca
// (ima svoju karticu), reklamacija ima svoju karticu, ostalo je završeno.
const NOT_LATE_STATUSES = ["isporucena", "potvrdjen_prijem", "zatvorena", "odbijena", "reklamacija"];

export function toMillis(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts.seconds === "number") return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
  return null;
}

// Ključ dana (YYYY-MM-DD) u vremenskoj zoni firme — za "Danas završeno".
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export function dayKey(ts) {
  const ms = toMillis(ts);
  return ms == null ? null : dayFmt.format(new Date(ms));
}

// Kašnjenje: računa se od trenutka dodele isporučiocu (assignedAt; za stare
// narudžbine bez tog polja — createdAt). Nedodeljena narudžbina ne kasni.
export function lateInfo(order, now = Date.now()) {
  if (!order || NOT_LATE_STATUSES.includes(order.status)) return null;
  if (!order.assignedToUid) return null;
  const start = toMillis(order.assignedAt) ?? toMillis(order.createdAt);
  if (start == null) return null;
  const limitH = order.priority === "hitno" ? LATE_LIMIT_HOURS.hitno : LATE_LIMIT_HOURS.standardno;
  const overdueMs = now - start - limitH * 3600000;
  return overdueMs > 0 ? { overdueMs } : null;
}
export const isLate = (order, now = Date.now()) => lateInfo(order, now) !== null;

export function durationParts(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  return { d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), m: totalMin % 60 };
}

// --- Pretraga ---------------------------------------------------------------
export function normalizeText(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj");
}

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

// Polja koja se čuvaju na dokumentu narudžbine radi pretrage i prikaza u tabeli
// (stavke i lokacije su u podkolekcijama, pa ih tabela ne bi mogla da prikaže).
export function buildSearchFields(order, items = [], locations = []) {
  const supplierNames = uniq(items.map((i) => i.supplierName));
  const deliveryLocationNames = uniq(locations.map((l) => l.locationName));
  const parts = uniq([
    order.orderNumber, order.createdByName, order.assignedToName, order.requestedByName,
    ...items.flatMap((i) => [i.productName, i.code, i.supplierName, i.substituteName]),
    ...deliveryLocationNames,
  ]);
  return {
    searchText: normalizeText(parts.join(" ")).slice(0, 20000),
    supplierNames,
    deliveryLocationNames,
  };
}

function haystack(order) {
  return normalizeText(order.searchText
    || [order.orderNumber, order.createdByName, order.assignedToName, order.requestedByName].join(" "));
}

// criteria: { text, statuses: [...], priorities: [...], from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// (status / priority kao pojedinačne vrednosti se i dalje prihvataju)
export function parseCriteria(c = {}) {
  const tokens = normalizeText(c.text || "").split(/\s+/).filter(Boolean);
  const fromMs = c.from ? new Date(`${c.from}T00:00:00`).getTime() : null;
  const toMs = c.to ? new Date(`${c.to}T23:59:59.999`).getTime() : null;
  const statuses = [...(c.statuses || []), ...(c.status ? [c.status] : [])];
  const priorities = [...(c.priorities || []), ...(c.priority ? [c.priority] : [])];
  return { tokens, fromMs, toMs, statuses, priorities, active: !!(tokens.length || fromMs || toMs || statuses.length || priorities.length) };
}

export function matchesSearch(order, parsed) {
  if (parsed.statuses.length && !parsed.statuses.includes(order.status)) return false;
  if (parsed.priorities.length && !parsed.priorities.includes(order.priority)) return false;
  if (parsed.fromMs || parsed.toMs) {
    const created = toMillis(order.createdAt);
    if (created == null) return false;
    if (parsed.fromMs && created < parsed.fromMs) return false;
    if (parsed.toMs && created > parsed.toMs) return false;
  }
  if (parsed.tokens.length) {
    const h = haystack(order);
    if (!parsed.tokens.every((tk) => h.includes(tk))) return false;
  }
  return true;
}

// --- Sortiranje -------------------------------------------------------------
const closedMs = (o) => toMillis(o.closedAt) ?? toMillis(o.updatedAt) ?? toMillis(o.createdAt) ?? 0;
const isClosed = (o) => CLOSED_STATUSES.includes(o.status);

// Naručilac: prvo ono što traži njegovu reakciju, pa kasne, pa ostalo (najnovije
// prve); zatvorene/odbijene na kraju po datumu zatvaranja.
export function compareNarucilac(now = Date.now()) {
  const rank = (o) => {
    if (o.status === "isporucena") return 0;
    if (o.status === "reklamacija") return 1;
    if (o.status === "kreirana") return 2;   // čeka da naručilac izabere isporučioca
    if (isClosed(o)) return 9;
    return isLate(o, now) ? 3 : 4;
  };
  return (a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 9) return closedMs(b) - closedMs(a);
    return (toMillis(b.createdAt) ?? now) - (toMillis(a.createdAt) ?? now);
  };
}

// Isporučilac: čeka prihvatanje, reklamacije, kasne, hitne, ostalo (najstarije
// prve — one su najbliže roku); zatvorene/odbijene na kraju.
export function compareIsporucilac(now = Date.now()) {
  const rank = (o) => {
    if (isClosed(o)) return 9;
    if (o.status === "ceka_prihvatanje") return 0;
    if (o.status === "reklamacija") return 1;
    if (isLate(o, now)) return 2;
    return o.priority === "hitno" ? 3 : 4;
  };
  const start = (o) => toMillis(o.assignedAt) ?? toMillis(o.createdAt) ?? now;
  return (a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 9) return closedMs(b) - closedMs(a);
    return start(a) - start(b);
  };
}

// Narudžbine koje su na vrhu iz razloga potrebne pažnje (a ne zbog datuma). Poklapaju se
// sa prvim rangovima u compare* funkcijama, pa uvek čine neprekidan blok na početku liste.
export const isAttentionNarucilac = (o, now = Date.now()) =>
  o.status === "isporucena" || o.status === "reklamacija" || o.status === "kreirana" || isLate(o, now);
export const isAttentionIsporucilac = (o, now = Date.now()) =>
  !isClosed(o) && (o.status === "ceka_prihvatanje" || o.status === "reklamacija" || isLate(o, now) || o.priority === "hitno");

// Dugmići ishoda u filterima (Aktivne / Zatvorene / Odbijene) → statusi koje obuhvataju
export const OUTCOME_STATUSES = { active: OPEN_STATUSES, closed: ["zatvorena"], rejected: ["odbijena"] };

// Prečice za period (lokalni datumi, YYYY-MM-DD): ovaj mesec, prošli mesec, poslednjih 90 dana
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function periodPresets(today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  return {
    this_month: { from: isoDate(new Date(y, m, 1)), to: isoDate(today) },
    last_month: { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) },
    last_90: { from: isoDate(new Date(y, m, d - 89)), to: isoDate(today) },
  };
}

export function compareByCreatedDesc(a, b) {
  return (toMillis(b.createdAt) ?? Infinity) - (toMillis(a.createdAt) ?? Infinity);
}
