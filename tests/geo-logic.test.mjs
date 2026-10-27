// Pokretanje: node tests/geo-logic.test.mjs
import assert from "node:assert/strict";
import {
  parseCoords, haversineKm, solveOrder, pathCost, buildLegs, haversineMatrix,
  buildGoogleMapsUrls, stripHouseNumber, buildStops, planRoute, routeMeters, moveStop, stopsToPoints, isValidCoord, fmtKm, fmtMinutes, qualityOf,
} from "../js/geo.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

ok("parseCoords: obični formati", () => {
  assert.deepEqual(parseCoords("44.8125, 20.4612"), { lat: 44.8125, lng: 20.4612 });
  assert.deepEqual(parseCoords("44.8125 20.4612"), { lat: 44.8125, lng: 20.4612 });
  assert.deepEqual(parseCoords("44.8125°N, 20.4612°E"), { lat: 44.8125, lng: 20.4612 });
  assert.equal(parseCoords("blabla"), null);
  assert.equal(parseCoords(""), null);
  assert.equal(parseCoords("200, 20"), null);
});
ok("parseCoords: Google Maps linkovi", () => {
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/X/@44.81,20.46,17z/data=!3m1!4b1!4m6!3m5!8m2!3d44.8123!4d20.4601"), { lat: 44.8123, lng: 20.4601 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/@44.8,20.4,15z"), { lat: 44.8, lng: 20.4 });
  assert.deepEqual(parseCoords("https://www.google.com/maps?q=44.8125,20.4612"), { lat: 44.8125, lng: 20.4612 });
  assert.equal(parseCoords("https://maps.app.goo.gl/abc123"), null);
});
ok("stripHouseNumber", () => {
  assert.equal(stripHouseNumber("Bulevar Mihajla Pupina 10, Beograd"), "Bulevar Mihajla Pupina, Beograd");
  assert.equal(stripHouseNumber("Požeška bb, Požega"), "Požeška, Požega");
});
ok("haversine: Beograd–Novi Sad ≈ 75 km", () => {
  const d = haversineKm({ lat: 44.7866, lng: 20.4489 }, { lat: 45.2671, lng: 19.8335 });
  assert.ok(d > 70 && d < 85, String(d));
});

// Tačke na pravoj liniji: polazna 0, stanice na 10, 30, 20 km → najbolji redosled 10, 20, 30
const line = [0, 10, 30, 20].map((x) => ({ lat: 44, lng: 20 + x / 80 }));
const M = haversineMatrix(line, { roadFactor: 1 });
ok("solveOrder: tačan redosled na liniji (free end)", () => {
  assert.deepEqual(solveOrder(M.distances, 3, "free"), [1, 3, 2]);
});
ok("solveOrder: povratak na start ne menja redosled na liniji", () => {
  const o = solveOrder(M.distances, 3, "start");
  assert.equal(o.length, 3);
  const fin = (i) => M.distances[i][0];
  assert.ok(pathCost(M.distances, o, fin) <= pathCost(M.distances, [1, 2, 3], fin) + 1e-6);
});
ok("solveOrder: heuristika (>12 stanica) daje punu permutaciju i nije gora od redosleda unosa", () => {
  const pts = Array.from({ length: 16 }, (_, i) => ({ lat: 44 + Math.sin(i * 7) * 0.3, lng: 20 + Math.cos(i * 3) * 0.3 }));
  const Mx = haversineMatrix(pts, { roadFactor: 1 });
  const o = solveOrder(Mx.distances, 15, "free");
  assert.deepEqual([...o].sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i + 1));
  const naive = Array.from({ length: 15 }, (_, i) => i + 1);
  assert.ok(pathCost(Mx.distances, o, () => 0) <= pathCost(Mx.distances, naive, () => 0));
});
ok("solveOrder: Held-Karp je optimalan (poređenje sa grubom silom, 6 stanica)", () => {
  const pts = Array.from({ length: 7 }, (_, i) => ({ lat: 44 + ((i * 37) % 11) / 20, lng: 20 + ((i * 53) % 13) / 20 }));
  const Mx = haversineMatrix(pts, { roadFactor: 1 });
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  const fin = (i) => Mx.distances[i][0];
  const best = Math.min(...perms([1, 2, 3, 4, 5, 6]).map((p) => pathCost(Mx.distances, p, fin)));
  const o = solveOrder(Mx.distances, 6, "start");
  assert.ok(Math.abs(pathCost(Mx.distances, o, fin) - best) < 1e-6);
});
ok("buildLegs: zbir deonica, povratak na start", () => {
  const o = solveOrder(M.distances, 3, "start");
  const r = buildLegs(M, o, "start", 3);
  assert.equal(r.legs.length, 4);
  assert.ok(Math.abs(r.totalMeters - r.legs.reduce((s, l) => s + l.meters, 0)) < 1e-6);
});
ok("buildGoogleMapsUrls: jedan link, GPS polazak (bez origin)", () => {
  const r = buildGoogleMapsUrls({ origin: null, ordered: [{ lat: 44.1, lng: 20.1 }, { lat: 44.2, lng: 20.2 }] });
  assert.equal(r.length, 1);
  const u = new URL(r[0].url);
  assert.equal(u.searchParams.get("origin"), null);
  assert.equal(u.searchParams.get("dir_action"), "navigate");
  assert.equal(u.searchParams.get("travelmode"), "driving");
  assert.equal(u.searchParams.get("destination"), "44.200000,20.200000");
  assert.equal(u.searchParams.get("waypoints"), "44.100000,20.100000");
});
ok("buildGoogleMapsUrls: deli na delove po 10 tačaka, sledeći deo kreće gde je prethodni stao", () => {
  const stops = Array.from({ length: 13 }, (_, i) => ({ lat: 44 + i / 100, lng: 20 }));
  const r = buildGoogleMapsUrls({ origin: { lat: 43, lng: 19 }, ordered: stops, endPoint: { lat: 43, lng: 19 } });
  assert.equal(r.length, 2);               // 14 tačaka → 10 + 4
  const u1 = new URL(r[0].url), u2 = new URL(r[1].url);
  assert.equal(u1.searchParams.get("waypoints").split("|").length, 9);
  assert.equal(u2.searchParams.get("origin"), u1.searchParams.get("destination"));
  assert.equal(u2.searchParams.get("destination"), "43.000000,19.000000");
});
ok("buildGoogleMapsUrls: stanica bez koordinata ide kao tekst adrese", () => {
  const r = buildGoogleMapsUrls({ origin: null, ordered: [{ lat: 44.1, lng: 20.1 }, "Ugrinovačka 12, Zemun"] });
  const u = new URL(r[0].url);
  assert.equal(u.searchParams.get("destination"), "Ugrinovačka 12, Zemun");
});
ok("qualityOf", () => {
  assert.equal(qualityOf({ addresstype: "house" }), "tacno");
  assert.equal(qualityOf({ addresstype: "road" }), "ulica");
  assert.equal(qualityOf({ addresstype: "city" }), "naselje");
});
ok("pomoćne: isValidCoord, fmtKm, fmtMinutes", () => {
  assert.ok(isValidCoord(44, 20)); assert.ok(!isValidCoord(0, 0)); assert.ok(!isValidCoord(NaN, 1));
  assert.equal(fmtKm(12500), "13 km"); assert.equal(fmtKm(2340), "2.3 km");
  assert.equal(fmtMinutes(50 * 60), "50 min"); assert.equal(fmtMinutes(95 * 60), "1 h 35 min");
});

// --- Stanice rute ---
const suppliersById = { s1: { name: "Dobavljač A", address: "Ugrinovačka 12, Zemun" }, s2: { name: "Dobavljač B", address: "Pijaca" }, s3: { name: "Dobavljač C", address: "Nepoznata 1" } };
const supplierLocsById = {
  s1: [{ id: "l1", name: "Zemun", address: "Ugrinovačka 12", lat: 44.84, lng: 20.39 }],
  s2: [{ id: "l2", name: "Pijaca", address: "Pijaca", lat: 44.80, lng: 20.46 }, { id: "l3", name: "Skladište", address: "x", lat: 44.70, lng: 20.40 }],
  s3: [],
};
const companyLocsById = { m1: { name: "Magacin Novi Beograd", address: "Bul. 1", lat: 44.81, lng: 20.42 }, m2: { name: "Prodavnica", address: "Y", lat: 44.75, lng: 20.50 } };
const orders = [
  { id: "o1", orderNumber: "NAR-0012", items: [
      { supplierId: "s1", supplierName: "Dobavljač A", pickupLocationId: "l1", purchaseStatus: "na_cekanju" },
      { supplierId: "s1", supplierName: "Dobavljač A", pickupLocationId: "any", purchaseStatus: "na_cekanju" },
      { supplierId: "s1", supplierName: "Dobavljač A", pickupLocationId: "l1", purchaseStatus: "kupljeno" },
      { supplierId: "s2", supplierName: "Dobavljač B", pickupLocationId: "l2", purchaseStatus: "na_cekanju" },
      { supplierId: "s3", supplierName: "Dobavljač C", pickupLocationId: "any", purchaseStatus: "na_cekanju" } ],
    deliveryLocations: [{ locationId: "m1", locationName: "Magacin Novi Beograd", status: "ceka" }, { locationId: "m2", locationName: "Prodavnica", status: "isporuceno" }] },
  { id: "o2", orderNumber: "NAR-0015", items: [{ supplierId: "s1", supplierName: "Dobavljač A", pickupLocationId: "l1", purchaseStatus: "na_cekanju" }],
    deliveryLocations: [{ locationId: "m1", locationName: "Magacin Novi Beograd", status: "ceka" }] },
  { id: "o3", orderNumber: "NAR-0016", items: [{ supplierId: "s2", pickupLocationId: "l2", purchaseStatus: "kupljeno" }], deliveryLocations: [{ locationId: "m2", locationName: "Prodavnica", status: "ceka" }] },
];
const { pickups, deliveries } = buildStops({ orders, suppliersById, supplierLocsById, companyLocsById });
ok("buildStops: ista lokacija u više narudžbina je jedna stanica; kupljeno ne ulazi", () => {
  const a = pickups.find((s) => s.key === "p:s1:l1");
  assert.equal(a.orders.length, 2);
  assert.equal(a.orders.find((o) => o.orderId === "o1").count, 2);   // l1 + "bilo koja" → ista stanica
  assert.equal(pickups.find((s) => s.key === "p:s2:l2").orders.length, 1);   // o3 kupljeno → nema
});
ok("buildStops: dobavljač bez koordinata ide po adresi", () => {
  const c = pickups.find((s) => s.key === "p:s3:main");
  assert.equal(c.hasCoords, false);
  assert.equal(stopsToPoints([c])[0], "Nepoznata 1");
});
ok("buildStops: isporuke — isporučena lokacija se preskače, narudžbina bez preuzimanja ulazi samo isporukom", () => {
  assert.equal(deliveries.length, 2);   // m1 (o1+o2) i m2 (o3)
  assert.equal(deliveries.find((s) => s.key === "d:m1").orders.length, 2);
  assert.ok(deliveries.find((s) => s.key === "d:m2").orders.some((o) => o.orderId === "o3"));
});
ok("planRoute: sva preuzimanja pre isporuka, najbliže prvo, bez koordinata na kraju grupe", () => {
  const start = { lat: 44.82, lng: 20.40 };
  const r = planRoute({ start, pickups, deliveries });
  const kinds = r.map((s) => s.kind);
  assert.equal(kinds.lastIndexOf("pickup") + 1, kinds.indexOf("delivery"));
  assert.equal(r[0].key, "p:s1:l1");                                // najbliža start tački
  assert.equal(r[pickups.length - 1].key, "p:s3:main");             // bez koordinata na kraju preuzimanja
});
ok("planRoute: nepoznat start (GPS odbijen) ne ruši računanje", () => {
  const r = planRoute({ start: null, pickups, deliveries });
  assert.equal(r.length, pickups.length + deliveries.length);
});
ok("moveStop: ne prelazi granicu preuzimanja/isporuka; routeMeters raste sa udaljenošću", () => {
  const r = planRoute({ start: null, pickups, deliveries });
  const lastPickup = r.map((s) => s.kind).lastIndexOf("pickup");
  assert.equal(moveStop(r, lastPickup, 1), r);
  assert.equal(moveStop(r, 0, -1), r);
  assert.ok(routeMeters(null, r) > 0);
});

console.log(`\n${n} testova prošlo`);
