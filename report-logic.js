// ============================================================================
// REPORT-LOGIC — čiste funkcije za izveštaje (bez Firebase-a, testira se u Node-u)
// ============================================================================

export function parseQty(q) {
  if (typeof q === "number") return Number.isFinite(q) ? q : 0;
  const n = Number(String(q ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const norm = (s) => String(s ?? "").trim().toLocaleLowerCase("sr");

// Po artiklima: ukupna naručena količina i broj narudžbina po artiklu.
// Isti artikal u različitim jedinicama mere ostaje u odvojenim redovima
// (količine u kg i kom se ne sabiraju). Artikal se prepoznaje po productId,
// pa po šifri, pa po nazivu.
export function aggregateByItem(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    (r.items || []).forEach((it) => {
      const unit = String(it.unit ?? "").trim();
      const id = it.productId || String(it.code ?? "").trim() || String(it.productName ?? "").trim();
      if (!id) return;
      const key = `${norm(id)}|${norm(unit)}`;
      if (!map.has(key)) map.set(key, { key, code: "", name: "", unit, quantity: 0, orderIds: new Set() });
      const e = map.get(key);
      if (!e.code && it.code) e.code = String(it.code).trim();
      if (!e.name && it.productName) e.name = String(it.productName).trim();
      e.quantity += parseQty(it.quantity);
      e.orderIds.add(r.id);
    });
  });
  return Array.from(map.values())
    .map((e) => ({ key: e.key, code: e.code, name: e.name || "—", unit: e.unit, quantity: e.quantity, orderCount: e.orderIds.size }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "sr"));
}

// Stavke grupisane po dobavljaču, redosled po prvom pojavljivanju.
export function groupItemsBySupplier(items) {
  const groups = [];
  const index = new Map();
  (items || []).forEach((it) => {
    const key = it.supplierId || it.supplierName || "—";
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ supplierId: it.supplierId || "", name: it.supplierName || "—", items: [] });
    }
    groups[index.get(key)].items.push(it);
  });
  return groups;
}

// Količina za prikaz: do 3 decimale, bez nepotrebnih nula.
export function fmtQty(n, locale = "sr-RS") {
  return (Number(n) || 0).toLocaleString(locale, { maximumFractionDigits: 3 });
}
