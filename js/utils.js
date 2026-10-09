// ============================================================================
// UTILS — zajedničke pomoćne funkcije i konstante (vidi Poglavlje 2 i 3 spec.)
// ============================================================================
import { t, currentLang } from "./i18n.js";

export const ROLES = {
  MASTER_ADMIN: "master_admin",
  ADMIN: "admin",
  NARUCILAC: "narucilac",
  ISPORUCILAC: "isporucilac",
};

// Ključevi prevoda za uloge (Poglavlje 13. — svi prikazani tekstovi idu kroz i18n)
const ROLE_I18N_KEYS = {
  master_admin: "role_master_admin",
  admin: "role_admin",
  narucilac: "role_narucilac",
  isporucilac: "role_isporucilac",
};

// Napomena: ROLE_LABELS se više NE koristi kao statički objekat (bio bi zamrznut
// na jeziku učitanom pri startu aplikacije). Umesto toga koristi roleLabel(role).
export function roleLabel(role) {
  return t(ROLE_I18N_KEYS[role]) || role;
}

// Statusi narudžbine — Poglavlje 3
export const ORDER_STATUS = {
  KREIRANA: "kreirana",
  CEKA_PRIHVATANJE: "ceka_prihvatanje",
  PRIHVACENA: "prihvacena",
  U_NABAVCI: "u_nabavci",
  ZAVRSENA_NABAVKA: "zavrsena_nabavka",
  U_ISPORUCI: "u_isporuci",
  ISPORUCENA: "isporucena",
  POTVRDJEN_PRIJEM: "potvrdjen_prijem",
  REKLAMACIJA: "reklamacija",
  ZATVORENA: "zatvorena",
  ODBIJENA: "odbijena",
};

const ORDER_STATUS_I18N_KEYS = {
  kreirana: "status_kreirana",
  ceka_prihvatanje: "status_ceka_prihvatanje",
  prihvacena: "status_prihvacena",
  u_nabavci: "in_purchase",
  zavrsena_nabavka: "status_zavrsena_nabavka",
  u_isporuci: "status_u_isporuci",
  isporucena: "status_isporucena",
  potvrdjen_prijem: "status_potvrdjen_prijem",
  reklamacija: "status_reklamacija",
  zatvorena: "status_zatvorena",
  odbijena: "status_odbijena",
};

// Napomena: ORDER_STATUS_LABELS je uklonjen kao statički objekat iz istog razloga
// kao ROLE_LABELS. Koristi statusLabel(status) da uvek dobiješ prevod za trenutni jezik.
export function statusLabel(status) {
  return t(ORDER_STATUS_I18N_KEYS[status]) || status;
}

// Za popunjavanje <select>/filtera svim statusima, redosledom definisanim gore.
export const ORDER_STATUS_ALL = Object.keys(ORDER_STATUS_I18N_KEYS);

// Redosled toka za progres-traku (Poglavlje 3)
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.KREIRANA, ORDER_STATUS.CEKA_PRIHVATANJE, ORDER_STATUS.PRIHVACENA,
  ORDER_STATUS.U_NABAVCI, ORDER_STATUS.ZAVRSENA_NABAVKA, ORDER_STATUS.U_ISPORUCI,
  ORDER_STATUS.ISPORUCENA, ORDER_STATUS.POTVRDJEN_PRIJEM, ORDER_STATUS.ZATVORENA,
];

export const PRIORITY = { HITNO: "hitno", STANDARDNO: "standardno" };

export const DELIVERY_LOCATION_STATUS = { CEKA: "ceka", ISPORUCENO: "isporuceno", POTVRDJENO: "potvrdjeno" };

export const ITEM_PURCHASE_STATUS = { NA_CEKANJU: "na_cekanju", KUPLJENO: "kupljeno", NIJE_PRONADJENO: "nije_pronadjeno", ZAMENA: "zamena" };

export const ASSIGNMENT_MODE = { AUTOMATSKI: "automatski", ADMIN_BIRA: "admin_bira", NARUCILAC_BIRA: "narucilac_bira" };

export function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Količina artikla sme da bude samo prirodan broj (1, 2, 3, ...) — bez nule,
// minusa i decimala. Koristi se svuda gde korisnik unosi/menja količinu, da
// koraci +/- na <input type="number"> i ručni unos uvek završe na celom broju ≥ 1.
export function normalizeQuantity(value, fallback = 1) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return d.toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDateShort(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const locale = currentLang === "en" ? "en-GB" : "sr-RS";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function toast(message, type = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

export function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function badgeClassForStatus(status) {
  const map = {
    kreirana: "badge-gray", ceka_prihvatanje: "badge-amber", prihvacena: "badge-blue",
    u_nabavci: "badge-blue", zavrsena_nabavka: "badge-blue", u_isporuci: "badge-blue",
    isporucena: "badge-teal", potvrdjen_prijem: "badge-green", zatvorena: "badge-green",
    reklamacija: "badge-red", odbijena: "badge-red",
  };
  return map[status] || "badge-gray";
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// --- Levenštajnova distanca (broj izmena karaktera potrebnih da se jedan string
// pretvori u drugi) — koristi se za detekciju sličnih naziva pri auto-katalogizaciji
// stavki iz slobodnog unosa narudžbenice. ---
export function levenshteinDistance(a = "", b = "") {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

// Normalizacija naziva radi poređenja (mala slova, jedan razmak, bez viška whitespace-a).
export function normalizeName(str = "") {
  return String(str).toLowerCase().trim().replace(/\s+/g, " ");
}

// Poredi uneti naziv sa nazivom iz kataloga.
// Vraća: "exact" (identičan posle normalizacije), "similar" (Levenštajn distanca
// zadovoljava I apsolutni I relativni prag — konzervativna kombinacija da kratki
// nazivi ne budu lažno pogođeni), ili "different".
export function compareItemNames(a, b, { maxDistance = 3, maxRelativeDistance = 0.2 } = {}) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return "different";
  if (na === nb) return "exact";
  const dist = levenshteinDistance(na, nb);
  const longer = Math.max(na.length, nb.length) || 1;
  const relative = dist / longer;
  if (dist > 0 && dist <= maxDistance && relative <= maxRelativeDistance) return "similar";
  return "different";
}

// Nađe najbolje poklapanje (exact ili similar) unetog naziva unutar liste proizvoda.
// products: niz objekata sa poljem "name". Vraća { type: "exact"|"similar", product } ili null.
export function findClosestCatalogMatch(name, products, options) {
  let bestSimilar = null;
  for (const p of products) {
    const result = compareItemNames(name, p.name, options);
    if (result === "exact") return { type: "exact", product: p };
    if (result === "similar" && !bestSimilar) bestSimilar = { type: "similar", product: p };
  }
  return bestSimilar;
}
