// Pokretanje: node tests/dash-logic.test.mjs
import assert from "node:assert/strict";
import {
  lateInfo, isLate, normalizeText, buildSearchFields, parseCriteria, matchesSearch,
  compareNarucilac, compareIsporucilac, dayKey, durationParts, toMillis,
  isAttentionNarucilac, isAttentionIsporucilac,
} from "../js/dash-logic.js";

const H = 3600000;
const now = Date.UTC(2026, 9, 9, 12, 0, 0);
const ts = (msAgo) => ({ toMillis: () => now - msAgo });
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };

ok("hitna: nije kasna u 1h59, kasna u 2h01", () => {
  const base = { status: "u_nabavci", priority: "hitno", assignedToUid: "u1" };
  assert.equal(isLate({ ...base, assignedAt: ts(1.99 * H) }, now), false);
  assert.equal(isLate({ ...base, assignedAt: ts(2.01 * H) }, now), true);
});
ok("standardna: granica 24h", () => {
  const base = { status: "u_nabavci", priority: "standardno", assignedToUid: "u1" };
  assert.equal(isLate({ ...base, assignedAt: ts(23 * H) }, now), false);
  assert.equal(isLate({ ...base, assignedAt: ts(25 * H) }, now), true);
});
ok("kasnjenje se računa od dodele, ne od kreiranja", () => {
  const o = { status: "ceka_prihvatanje", priority: "hitno", assignedToUid: "u1", createdAt: ts(50 * H), assignedAt: ts(1 * H) };
  assert.equal(isLate(o, now), false);
});
ok("stare narudžbine bez assignedAt koriste createdAt", () => {
  const o = { status: "u_nabavci", priority: "hitno", assignedToUid: "u1", createdAt: ts(5 * H) };
  assert.equal(isLate(o, now), true);
});
ok("nedodeljena narudžbina ne kasni", () => {
  assert.equal(isLate({ status: "kreirana", priority: "hitno", createdAt: ts(99 * H) }, now), false);
});
ok("isporučena, reklamacija, zatvorena, odbijena ne kasne", () => {
  for (const status of ["isporucena", "reklamacija", "zatvorena", "odbijena", "potvrdjen_prijem"]) {
    assert.equal(isLate({ status, priority: "hitno", assignedToUid: "u1", assignedAt: ts(99 * H) }, now), false, status);
  }
});
ok("trajanje kašnjenja", () => {
  const o = { status: "u_nabavci", priority: "hitno", assignedToUid: "u1", assignedAt: ts(5.5 * H) };
  assert.deepEqual(durationParts(lateInfo(o, now).overdueMs), { d: 0, h: 3, m: 30 });
});
ok("normalizeText: dijakritici i đ", () => {
  assert.equal(normalizeText("Čelik ŠRAF Đorđe žica"), "celik sraf djordje zica");
});
ok("pretraga po delu reči i po svim rečima (AND)", () => {
  const items = [{ productName: "Cement PC 42,5", code: "C-01", supplierName: "Građevinar d.o.o." }];
  const f = buildSearchFields({ orderNumber: "NAR-1/26", createdByName: "Marko Petrović", assignedToName: "Žarko", requestedByName: "Ing. Ilić" }, items, [{ locationName: "Gradilište Niš" }]);
  const o = { orderNumber: "NAR-1/26", ...f };
  assert.ok(matchesSearch(o, parseCriteria({ text: "cem" })));
  assert.ok(matchesSearch(o, parseCriteria({ text: "gradjevinar zarko" })));
  assert.ok(matchesSearch(o, parseCriteria({ text: "ilic nis" })));
  assert.ok(!matchesSearch(o, parseCriteria({ text: "cement beograd" })));
  assert.deepEqual(f.supplierNames, ["Građevinar d.o.o."]);
  assert.deepEqual(f.deliveryLocationNames, ["Gradilište Niš"]);
});
ok("pretraga: status, prioritet i datumi", () => {
  const o = { orderNumber: "A", status: "zatvorena", priority: "hitno", createdAt: { toMillis: () => new Date("2026-03-10T10:00:00").getTime() } };
  assert.ok(matchesSearch(o, parseCriteria({ statuses: ["zatvorena", "odbijena"], priorities: ["hitno"], from: "2026-03-10", to: "2026-03-10" })));
  assert.ok(!matchesSearch(o, parseCriteria({ from: "2026-03-11" })));
  assert.ok(!matchesSearch(o, parseCriteria({ statuses: ["u_nabavci", "odbijena"] })));
  assert.ok(matchesSearch(o, parseCriteria({ status: "zatvorena" })));
  assert.ok(!matchesSearch(o, parseCriteria({ priorities: ["standardno"] })));
  assert.equal(parseCriteria({}).active, false);
});
ok("stare narudžbine bez searchText se i dalje nalaze po broju/imenima", () => {
  assert.ok(matchesSearch({ orderNumber: "NAR-7", createdByName: "Ana" }, parseCriteria({ text: "ana" })));
});
ok("sortiranje isporučioca: prihvatanje, reklamacija, kasne, hitne, ostalo, zatvorene", () => {
  const mk = (id, extra) => ({ id, assignedToUid: "u", priority: "standardno", assignedAt: ts(1 * H), ...extra });
  const list = [
    mk("zatv", { status: "zatvorena", closedAt: ts(1 * H) }),
    mk("obicna", { status: "u_nabavci" }),
    mk("hitna", { status: "u_nabavci", priority: "hitno", assignedAt: ts(0.5 * H) }),
    mk("kasna", { status: "u_nabavci", priority: "hitno", assignedAt: ts(5 * H) }),
    mk("rekl", { status: "reklamacija" }),
    mk("cekaj", { status: "ceka_prihvatanje" }),
  ];
  assert.deepEqual(list.sort(compareIsporucilac(now)).map((o) => o.id), ["cekaj", "rekl", "kasna", "hitna", "obicna", "zatv"]);
});
ok("sortiranje naručioca: potvrda, reklamacija, kasne, ostalo (najnovije prve), zatvorene", () => {
  const mk = (id, extra) => ({ id, assignedToUid: "u", priority: "standardno", createdAt: ts(1 * H), ...extra });
  const list = [
    mk("zatv", { status: "zatvorena", closedAt: ts(1 * H) }),
    mk("starija", { status: "u_nabavci", createdAt: ts(3 * H) }),
    mk("novija", { status: "u_nabavci", createdAt: ts(2 * H) }),
    mk("kasna", { status: "u_nabavci", priority: "hitno", assignedAt: ts(5 * H) }),
    mk("rekl", { status: "reklamacija" }),
    mk("isporucena", { status: "isporucena" }),
  ];
  assert.deepEqual(list.sort(compareNarucilac(now)).map((o) => o.id), ["isporucena", "rekl", "kasna", "novija", "starija", "zatv"]);
});
ok("dayKey koristi zonu Europe/Belgrade (ponoć po lokalnom vremenu)", () => {
  // 22:30 UTC u julu = 00:30 sledećeg dana u Beogradu (CEST, UTC+2)
  assert.equal(dayKey(Date.UTC(2026, 6, 1, 22, 30)), "2026-07-02");
  assert.equal(dayKey(Date.UTC(2026, 6, 1, 21, 30)), "2026-07-01");
  assert.equal(toMillis(null), null);
});
ok("blok 'zahteva pažnju' je uvek neprekidan početak sortirane liste (obe uloge)", () => {
  const statuses = ["kreirana", "ceka_prihvatanje", "u_nabavci", "isporucena", "reklamacija", "zatvorena", "odbijena"];
  const list = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) list.push({
    id: i, status: statuses[Math.floor(rnd() * statuses.length)], priority: rnd() < 0.4 ? "hitno" : "standardno",
    assignedToUid: rnd() < 0.9 ? "u" : null, assignedAt: ts(rnd() * 60 * H), createdAt: ts(rnd() * 60 * H), closedAt: ts(rnd() * 60 * H),
  });
  for (const [cmp, isAttn] of [[compareNarucilac, isAttentionNarucilac], [compareIsporucilac, isAttentionIsporucilac]]) {
    const flags = [...list].sort(cmp(now)).map((o) => isAttn(o, now));
    const firstFalse = flags.indexOf(false);
    assert.ok(firstFalse > 0 && !flags.slice(firstFalse).includes(true), "blok nije neprekidan");
  }
});
console.log(`\n${n} testova prošlo.`);
