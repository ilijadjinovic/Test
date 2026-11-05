// Pokretanje: node tests/carry-over-logic.test.mjs
import assert from "node:assert/strict";
import { calcShortages, resolvePickup, resolveDelivery, draftLocations, buildCarryOverDraft, finalizeCarryOver } from "../js/carry-over-logic.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

ok("calcShortages: nije stiglo / delimično / u celosti / višak", () => {
  const r = calcShortages([
    { itemId: "a", requested: 10, received: 0 }, { itemId: "b", requested: 10, received: 6 },
    { itemId: "c", requested: 5, received: 5 }, { itemId: "d", requested: 5, received: 7 },
  ]);
  assert.deepEqual(r.shortages, [{ itemId: "a", missingQty: 10 }, { itemId: "b", missingQty: 4 }]);
  assert.equal(r.invalidItemId, null);
});
ok("calcShortages: neispravan unos", () => {
  assert.equal(calcShortages([{ itemId: "x", requested: 3, received: -1 }]).invalidItemId, "x");
  assert.equal(calcShortages([{ itemId: "y", requested: 3, received: NaN }]).invalidItemId, "y");
});
ok("calcShortages: bez greške u pokretnom zarezu", () => {
  assert.equal(calcShortages([{ itemId: "z", requested: 0.3, received: 0.1 }]).shortages[0].missingQty, 0.2);
});

const locs2 = [{ id: "L1", name: "Magacin" }, { id: "L2", name: "Prodavnica" }];
ok("resolvePickup: zadržava izabrano mesto iz originala", () => {
  assert.deepEqual(resolvePickup({ pickupLocationId: "L2" }, locs2), { id: "L2", name: "Prodavnica" });
});
ok("resolvePickup: obrisano mesto + jedno preostalo -> to jedno", () => {
  assert.deepEqual(resolvePickup({ pickupLocationId: "X" }, [locs2[0]]), { id: "L1", name: "Magacin" });
});
ok("resolvePickup: 'any' + jedno mesto -> to mesto; 'any' + više mesta -> any", () => {
  assert.equal(resolvePickup({ pickupLocationId: "any" }, [locs2[0]]).id, "L1");
  assert.equal(resolvePickup({ pickupLocationId: "any" }, locs2).id, "any");
  assert.equal(resolvePickup({}, []).id, "any");
});

const origLocs = [
  { id: "sub1", locationId: "M1", locationName: "Gradilište A" },
  { id: "sub2", locationId: "M2", locationName: "Gradilište B" },
  { id: "sub3", locationId: "M3", locationName: "Dobavljač X – Centar", kind: "supplier", supplierId: "S9", supplierLocationId: "SL1" },
];
ok("resolveDelivery: ID podkolekcije se preslikava na matični ID", () => {
  const d = draftLocations(origLocs);
  assert.deepEqual(resolveDelivery({ deliveryLocationId: "sub2" }, d), { id: "M2", name: "Gradilište B" });
  assert.equal(resolveDelivery({ deliveryLocationId: "any" }, d).id, "any");
  assert.equal(resolveDelivery({ deliveryLocationId: "any" }, [d[0]]).id, "M1");
});

const items = [
  { id: "i1", supplierId: "S1", supplierName: "Alfa", productId: "P1", productName: "Cement", code: "C-1", unit: "kg", quantity: 10, note: "hitno", pickupLocationId: "L2", pickupLocationName: "Prodavnica", deliveryLocationId: "sub2", deliveryLocationName: "Gradilište B" },
  { id: "i2", supplierId: "S1", supplierName: "Alfa", productId: "", productName: "Ručni unos", unit: "kom", quantity: 4, manualEntry: true, pickupLocationId: "any", deliveryLocationId: "sub1" },
  { id: "i3", supplierId: "S2", supplierName: "Beta", productId: "P3", productName: "Šrafovi", unit: "kom", quantity: 100, pickupLocationId: "B1", deliveryLocationId: "sub1" },
];
const locsBySupplier = { S1: locs2, S2: [{ id: "B1", name: "Beta centrala" }] };
ok("buildCarryOverDraft: prenosi dobavljača, šifru, mesto preuzimanja i isporuke", () => {
  const draft = buildCarryOverDraft({ items, deliveryLocations: origLocs, shortages: [{ itemId: "i1", missingQty: 6 }, { itemId: "i2", missingQty: 4 }], locsBySupplier });
  assert.equal(draft.items.length, 2);
  const a = draft.items[0];
  assert.equal(a.quantity, 6); assert.equal(a.code, "C-1"); assert.equal(a.productId, "P1");
  assert.equal(a.pickupLocationId, "L2"); assert.equal(a.pickupLocationName, "Prodavnica");
  assert.equal(a.deliveryLocationId, "M2"); assert.equal(a.pickupOptions.length, 2);
  const b = draft.items[1];
  assert.equal(b.pickupLocationId, "any"); assert.equal(b.deliveryLocationId, "M1"); assert.equal(b.manualEntry, true);
  assert.equal(draft.locations.length, 3);
  assert.equal(draft.locations[2].kind, "supplier");
});
ok("finalizeCarryOver: samo korišćene lokacije isporuke, 'any' dobija prevedeni naziv", () => {
  const draft = buildCarryOverDraft({ items, deliveryLocations: origLocs, shortages: [{ itemId: "i1", missingQty: 6 }, { itemId: "i2", missingQty: 4 }], locsBySupplier });
  const rows = draft.items.map((r) => ({ ...r, include: true }));
  const out = finalizeCarryOver(draft, rows, { anyLabel: "Bilo koja lokacija", autoNote: "Preneto" });
  assert.deepEqual(out.deliveryLocations.map((l) => l.locationId).sort(), ["M1", "M2"]);
  assert.equal(out.items[1].pickupLocationName, "Bilo koja lokacija");
  assert.equal(out.items[1].note, "Preneto"); assert.equal(out.items[0].note, "hitno");
  assert.ok(!("pickupOptions" in out.items[0]) && !("srcItemId" in out.items[0]));
});
ok("finalizeCarryOver: isključen artikal otpada; promena mesta preuzimanja se poštuje", () => {
  const draft = buildCarryOverDraft({ items, deliveryLocations: origLocs, shortages: [{ itemId: "i1", missingQty: 6 }, { itemId: "i2", missingQty: 4 }], locsBySupplier });
  const rows = draft.items.map((r) => ({ ...r, include: r.srcItemId === "i1" }));
  rows[0].pickupLocationId = "L1"; rows[0].pickupLocationName = "Magacin";
  const out = finalizeCarryOver(draft, rows);
  assert.equal(out.items.length, 1); assert.equal(out.items[0].pickupLocationId, "L1");
  assert.deepEqual(out.deliveryLocations.map((l) => l.locationId), ["M2"]);
});
ok("finalizeCarryOver: svi 'any' -> sve originalne lokacije isporuke", () => {
  const draft = buildCarryOverDraft({ items: [{ ...items[1], deliveryLocationId: "any" }], deliveryLocations: origLocs, shortages: [{ itemId: "i2", missingQty: 4 }], locsBySupplier });
  const out = finalizeCarryOver(draft, draft.items.map((r) => ({ ...r, include: true })));
  assert.equal(out.deliveryLocations.length, 3);
});

console.log(`\n${n} testova prošlo.`);
