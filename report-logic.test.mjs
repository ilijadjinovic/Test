// Pokretanje: node tests/report-logic.test.mjs
import assert from "node:assert/strict";
import { aggregateByItem, groupItemsBySupplier, parseQty, fmtQty } from "../js/report-logic.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

const rows = [
  { id: "o1", items: [
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 10, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p2", code: "2210", productName: "Paradajz", quantity: "2,5", unit: "kg", supplierId: "s2", supplierName: "Delta" },
  ] },
  { id: "o2", items: [
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 5, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p1", code: "1012", productName: "Brašno T-500", quantity: 1, unit: "kom", supplierId: "s1", supplierName: "Metro" },
    { productId: "p2", code: "2210", productName: "Paradajz", quantity: 3, unit: "kom", supplierId: "s2", supplierName: "Delta" },
  ] },
  { id: "o3", items: [] },
  { id: "o4" },
];

ok("parseQty: broj, tačka, zarez, smeće", () => {
  assert.equal(parseQty(4), 4); assert.equal(parseQty("2,5"), 2.5); assert.equal(parseQty("3.25"), 3.25);
  assert.equal(parseQty("abc"), 0); assert.equal(parseQty(null), 0); assert.equal(parseQty(undefined), 0);
});
ok("aggregateByItem: sabira količine istog artikla i jedinice", () => {
  const a = aggregateByItem(rows);
  const brasno = a.find((x) => x.code === "1012");
  assert.equal(brasno.quantity, 16);
  assert.equal(brasno.orderCount, 2);   // 2 narudžbine, iako ima 3 stavke
});
ok("aggregateByItem: različite jedinice mere se ne sabiraju", () => {
  const a = aggregateByItem(rows).filter((x) => x.code === "2210");
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => x.unit).sort(), ["kg", "kom"]);
});
ok("aggregateByItem: sortirano po količini opadajuće", () => {
  const q = aggregateByItem(rows).map((x) => x.quantity);
  assert.deepEqual(q, [...q].sort((x, y) => y - x));
});
ok("aggregateByItem: narudžbine bez stavki ne smetaju; prazan ulaz", () => {
  assert.deepEqual(aggregateByItem([{ id: "x" }, { id: "y", items: [] }]), []);
  assert.deepEqual(aggregateByItem(undefined), []);
});
ok("aggregateByItem: bez productId koristi šifru pa naziv, ne razlikuje velika/mala slova", () => {
  const a = aggregateByItem([{ id: "o", items: [
    { productName: "Kafa", quantity: 1, unit: "kg" }, { productName: "kafa ", quantity: 2, unit: "KG" },
  ] }]);
  assert.equal(a.length, 1); assert.equal(a[0].quantity, 3);
});
ok("groupItemsBySupplier: grupiše po dobavljaču, redosled prvog pojavljivanja", () => {
  const g = groupItemsBySupplier(rows[1].items);
  assert.deepEqual(g.map((x) => x.name), ["Metro", "Delta"]);
  assert.equal(g[0].items.length, 2);
  assert.deepEqual(groupItemsBySupplier(undefined), []);
});
ok("fmtQty: do 3 decimale, bez nula viška", () => {
  assert.equal(fmtQty(10, "en-GB"), "10"); assert.equal(fmtQty(2.5, "en-GB"), "2.5"); assert.equal(fmtQty(1.23456, "en-GB"), "1.235");
});
console.log(`\n${n} testova prošlo`);
