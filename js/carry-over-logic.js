// ============================================================================
// PRENOS MANJKA U NOVU NARUDŽBINU — čista logika (bez Firebase-a, testira se u Node-u)
// Pokretanje testova: node tests/carry-over-logic.test.mjs
// ----------------------------------------------------------------------------
// Tok: potvrda prijema -> manjak -> NACRT nove narudžbine (unapred popunjen iz originala:
// dobavljač, mesto preuzimanja, mesto isporuke) -> naručilac po želji menja -> finalizacija
// u oblik koji prima createOrder (isti kao kad naručilac sam popuni formu).
// ============================================================================

export const ANY = "any";

const round3 = (n) => Math.round(n * 1000) / 1000;

// rows: [{ itemId, requested, received }] -> { shortages: [{itemId, missingQty}], invalidItemId }
// "invalidItemId" je prvi red sa neispravnom (nebrojčanom ili negativnom) primljenom količinom.
export function calcShortages(rows) {
  const shortages = [];
  for (const r of rows) {
    const requested = Number(r.requested), received = Number(r.received);
    if (!Number.isFinite(received) || received < 0) return { shortages: [], invalidItemId: r.itemId };
    if (received < requested) shortages.push({ itemId: r.itemId, missingQty: round3(requested - received) });
  }
  return { shortages, invalidItemId: null };
}

// Mesto preuzimanja: zadrži iz originala ako dobavljač to mesto još ima; ako nema a dobavljač ima tačno
// jedno mesto — to; inače "Bilo koja lokacija" (naručilac može da promeni pre slanja).
export function resolvePickup(item, supplierLocs = []) {
  const cur = item.pickupLocationId || ANY;
  const found = cur !== ANY ? supplierLocs.find((l) => l.id === cur) : null;
  if (found) return { id: found.id, name: found.name || item.pickupLocationName || "" };
  if (supplierLocs.length === 1) return { id: supplierLocs[0].id, name: supplierLocs[0].name || "" };
  return { id: ANY, name: "" };
}

// Odredište dobavljača (povrat robe) nosi dodatna polja; lokacija firme ne.
export function supplierDestFields(l) {
  return l && l.kind === "supplier" ? { kind: "supplier", supplierId: l.supplierId || "", supplierLocationId: l.supplierLocationId || "" } : {};
}

// Lokacije isporuke originalne narudžbine u obliku koji prima createOrder.
// Ključ je ID iz matične liste lokacija (locationId) — createOrder njime preslikava stavke na nove dokumente.
export function draftLocations(deliveryLocations) {
  return deliveryLocations.map((l) => ({
    key: l.locationId || l.id, subId: l.id,
    loc: { locationId: l.locationId || l.id, locationName: l.locationName, ...supplierDestFields(l) },
  }));
}

export function resolveDelivery(item, dLocs) {
  const cur = item.deliveryLocationId;
  const found = cur && cur !== ANY ? dLocs.find((d) => d.subId === cur || d.key === cur) : null;
  if (found) return { id: found.key, name: found.loc.locationName };
  if (dLocs.length === 1) return { id: dLocs[0].key, name: dLocs[0].loc.locationName };
  return { id: ANY, name: "" };
}

// NACRT: items = stavke originalne narudžbine; shortages iz calcShortages; locsBySupplier = { [supplierId]: [{id,name}] }
export function buildCarryOverDraft({ items, deliveryLocations, shortages, locsBySupplier = {} }) {
  const missing = new Map(shortages.map((s) => [s.itemId, s.missingQty]));
  const dLocs = draftLocations(deliveryLocations);
  const draftItems = items.filter((i) => missing.has(i.id)).map((i) => {
    const supplierLocs = locsBySupplier[i.supplierId] || [];
    const p = resolvePickup(i, supplierLocs);
    const d = resolveDelivery(i, dLocs);
    return {
      srcItemId: i.id,
      supplierId: i.supplierId || "", supplierName: i.supplierName || "",
      productId: i.productId || "", productName: i.productName || "", code: i.code || "", unit: i.unit || "",
      note: i.note || "", manualEntry: !!i.manualEntry,
      quantity: missing.get(i.id), missingQty: missing.get(i.id),
      pickupLocationId: p.id, pickupLocationName: p.name,
      pickupOptions: supplierLocs.map((l) => ({ id: l.id, name: l.name || "" })),
      deliveryLocationId: d.id, deliveryLocationName: d.name,
    };
  });
  return {
    items: draftItems,
    deliveryOptions: dLocs.map((d) => ({ id: d.key, name: d.loc.locationName })),
    locations: dLocs.map((d) => d.loc),
  };
}

// FINALIZACIJA: rows = redovi iz dijaloga (include, quantity, pickupLocationId/Name, deliveryLocationId/Name + polja nacrta).
// anyLabel = prevedeno "Bilo koja lokacija". Vraća { items, deliveryLocations } za createOrder.
export function finalizeCarryOver(draft, rows, { anyLabel = "", autoNote = "" } = {}) {
  const chosen = rows.filter((r) => r.include);
  const items = chosen.map((r) => ({
    supplierId: r.supplierId, supplierName: r.supplierName,
    productId: r.productId, productName: r.productName, code: r.code, unit: r.unit,
    quantity: r.quantity, note: r.note || autoNote, manualEntry: r.manualEntry,
    pickupLocationId: r.pickupLocationId || ANY,
    pickupLocationName: !r.pickupLocationId || r.pickupLocationId === ANY ? anyLabel : r.pickupLocationName,
    deliveryLocationId: r.deliveryLocationId || ANY,
    deliveryLocationName: !r.deliveryLocationId || r.deliveryLocationId === ANY ? anyLabel : r.deliveryLocationName,
  }));
  // Lokacije isporuke nove narudžbine: samo one na koje ide bar jedan artikal; ako su svi "bilo koja" — sve originalne.
  const used = new Set(items.map((i) => i.deliveryLocationId).filter((id) => id && id !== ANY));
  const locs = used.size ? draft.locations.filter((l) => used.has(l.locationId)) : draft.locations;
  return { items, deliveryLocations: locs };
}
