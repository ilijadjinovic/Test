// ============================================================================
// REPORTS — učitavanje i agregacija podataka za izveštaje (Poglavlje 7)
// Izveštaji: po narudžbenicama, po naručiocima, po isporučiocima,
// po dobavljačima, finansijski pregled.
// ============================================================================
import { db, collection, getDocs, orderBy, query, limit, where, startAfter, Timestamp } from "./firebase-init.js";
import { getOrderItems, getOrderPurchases } from "./orders.js";
import { t } from "./i18n.js";

// Narudžbine firme po stranama od po 500, opciono ograničene periodom kreiranja
// (filtriranje radi baza, ne browser). Ranije se učitavalo samo poslednjih 500 i
// tek onda filtriralo po periodu, pa su izveštaji za starije periode bili
// nepotpuni. max = gornja granica radi zaštite (5000).
export async function getOrdersInRange(companyId, { dateFrom = null, dateTo = null, max = 5000 } = {}) {
  const ordersRef = collection(db, "companies", companyId, "orders");
  const filters = [];
  if (dateFrom) filters.push(where("createdAt", ">=", Timestamp.fromDate(dateFrom)));
  if (dateTo) filters.push(where("createdAt", "<=", Timestamp.fromDate(dateTo)));
  const out = [];
  let cursor = null;
  while (out.length < max) {
    const parts = [...filters, orderBy("createdAt", "desc")];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(Math.min(500, max - out.length)));
    const snap = await getDocs(query(ordersRef, ...parts));
    out.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (snap.docs.length < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

export async function getAllOrdersOnce(companyId, max = 5000) {
  return getOrdersInRange(companyId, { max });
}

// Učitava narudžbine (opciono filtrirane po periodu kreiranja) zajedno sa
// njihovim stavkama i nabavkama (potrebno za finansijske i detaljne izveštaje).
// dateFrom / dateTo: JS Date objekti (opciono).
export async function buildReportDataset(companyId, { dateFrom = null, dateTo = null, max = 5000 } = {}) {
  const filtered = await getOrdersInRange(companyId, { dateFrom, dateTo, max });

  // Stavke i nabavke se čitaju u grupama (da se ne pokrene hiljade upita odjednom)
  const rows = [];
  for (let i = 0; i < filtered.length; i += 25) {
    const chunk = filtered.slice(i, i + 25);
    rows.push(...await Promise.all(chunk.map(async (o) => {
      const [items, purchases] = await Promise.all([
        getOrderItems(companyId, o.id).catch(() => []),
        getOrderPurchases(companyId, o.id).catch(() => []),
      ]);
      const total = purchases.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0);
      return { ...o, items, purchases, total };
    })));
  }
  return rows;
}

// --- Klijentski filteri (primenjuju se na već učitani dataset) ---
export function applyReportFilters(rows, { narucilacUid = "", isporucilacUid = "", supplierId = "", status = "", requestedBy = "" } = {}) {
  const needle = requestedBy.trim().toLocaleLowerCase("sr");
  return rows.filter((r) => {
    if (narucilacUid && r.createdByUid !== narucilacUid) return false;
    if (isporucilacUid && r.assignedToUid !== isporucilacUid) return false;
    if (status && r.status !== status) return false;
    if (supplierId && !(r.supplierIds || []).includes(supplierId)) return false;
    if (needle && !(r.requestedByName || "").toLocaleLowerCase("sr").includes(needle)) return false;
    return true;
  });
}

// --- Agregacije ---

// Po naručiocima: broj narudžbina i ukupan iznos po naručiocu koji je kreirao narudžbinu
export function aggregateByNarucilac(rows) {
  return aggregateByOrderField(rows, (r) => r.createdByUid, (r) => r.createdByName || "—");
}

// Po isporučiocima: broj narudžbina i ukupan iznos po dodeljenom isporučiocu
export function aggregateByIsporucilac(rows) {
  return aggregateByOrderField(rows, (r) => r.assignedToUid, (r) => r.assignedToName || t("not_assigned"));
}

function aggregateByOrderField(rows, keyFn, nameFn) {
  const map = new Map();
  rows.forEach((r) => {
    const key = keyFn(r) || "—";
    if (!map.has(key)) map.set(key, { key, name: nameFn(r), orderCount: 0, total: 0 });
    const entry = map.get(key);
    entry.orderCount += 1;
    entry.total += r.total;
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// Po dobavljačima: agregacija na nivou Purchase dokumenata (jedna narudžbina može
// obuhvatiti više dobavljača), broji koliko različitih narudžbina i ukupan iznos.
export function aggregateBySupplier(rows) {
  const map = new Map();
  rows.forEach((r) => {
    (r.purchases || []).forEach((p) => {
      if (!p.supplierId) return;
      if (!map.has(p.supplierId)) map.set(p.supplierId, { key: p.supplierId, name: p.supplierName || "—", orderIds: new Set(), total: 0 });
      const entry = map.get(p.supplierId);
      entry.orderIds.add(r.id);
      entry.total += Number(p.paidAmount) || 0;
    });
  });
  return Array.from(map.values())
    .map((e) => ({ key: e.key, name: e.name, orderCount: e.orderIds.size, total: e.total }))
    .sort((a, b) => b.total - a.total);
}

// Finansijski pregled — ukupan zbir i broj narudžbina sa/bez unetog iznosa
export function financialSummary(rows) {
  const withAmount = rows.filter((r) => r.total > 0);
  return {
    totalOrders: rows.length,
    ordersWithFinance: withAmount.length,
    ordersWithoutFinance: rows.length - withAmount.length,
    totalAmount: rows.reduce((s, r) => s + r.total, 0),
    avgAmount: withAmount.length ? withAmount.reduce((s, r) => s + r.total, 0) / withAmount.length : 0,
  };
}
