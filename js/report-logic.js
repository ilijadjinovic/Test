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
      if (!map.has(key)) map.set(key, { key, code: "", name: "", unit, quantity: 0, perOrder: new Map() });
      const e = map.get(key);
      if (!e.code && it.code) e.code = String(it.code).trim();
      if (!e.name && it.productName) e.name = String(it.productName).trim();
      const q = parseQty(it.quantity);
      e.quantity += q;
      // orders: za svaku narudžbinu u kojoj se artikal nalazi, količina tog artikla u njoj
      if (!e.perOrder.has(r.id)) e.perOrder.set(r.id, { r, quantity: 0 });
      e.perOrder.get(r.id).quantity += q;
    });
  });
  return Array.from(map.values())
    .map((e) => ({ key: e.key, code: e.code, name: e.name || "—", unit: e.unit, quantity: e.quantity, orderCount: e.perOrder.size, orders: Array.from(e.perOrder.values()) }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "sr"));
}

// Po dobavljačima: narudžbina se računa za dobavljača ako on postoji u njenim STAVKAMA
// ili u njenim NABAVKAMA (unija; jedna narudžbina se broji jednom). Iznos („total") dolazi
// samo iz nabavki. orders: za svaku narudžbinu iznos plaćen baš tom dobavljaču.
export function aggregateBySupplier(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const touch = (id, name, paid) => {
      if (!id) return;
      if (!map.has(id)) map.set(id, { key: id, name: "", perOrder: new Map(), total: 0 });
      const e = map.get(id);
      if (!e.name && name) e.name = String(name).trim();
      if (!e.perOrder.has(r.id)) e.perOrder.set(r.id, { r, amount: 0 });
      e.perOrder.get(r.id).amount += paid;
      e.total += paid;
    };
    (r.items || []).forEach((it) => touch(it.supplierId, it.supplierName, 0));
    (r.purchases || []).forEach((p) => touch(p.supplierId, p.supplierName, Number(p.paidAmount) || 0));
  });
  return Array.from(map.values())
    .map((e) => ({ key: e.key, name: e.name || "—", orderCount: e.perOrder.size, total: e.total, orders: Array.from(e.perOrder.values()) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "sr"));
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
