// Pokretanje: node tests/dash-logic.test.mjs
import assert from "node:assert/strict";
import {
  lateInfo, isLate, normalizeText, buildSearchFields, parseCriteria, matchesSearch,
  compareNarucilac, compareIsporucilac, dayKey, durationParts, toMillis,
  isAttentionNarucilac, isAttentionIsporucilac, periodPresets, OUTCOME_STATUSES, OPEN_STATUSES,
  allViewList, PAGE_SIZE, orderNumberPrefix,
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
ok("naručilac: 'kreirana' (čeka izbor isporučioca) je u bloku pažnje, posle reklamacije a pre kasnih", () => {
  const mk = (id, extra) => ({ id, priority: "standardno", createdAt: ts(1 * H), ...extra });
  const list = [
    mk("obicna", { status: "u_nabavci" }),
    mk("kasna", { status: "u_nabavci", priority: "hitno", assignedToUid: "u", assignedAt: ts(5 * H) }),
    mk("kre", { status: "kreirana" }),
    mk("rekl", { status: "reklamacija" }),
  ];
  assert.equal(isAttentionNarucilac(list[2], now), true);
  assert.deepEqual(list.sort(compareNarucilac(now)).map((o) => o.id), ["rekl", "kre", "kasna", "obicna"]);
  assert.equal(isAttentionIsporucilac({ status: "kreirana", priority: "standardno" }, now), false); // za isporučioca nije relevantno
});
ok("prečice za period: ovaj mesec, prošli mesec, poslednjih 90 dana", () => {
  const p = periodPresets(new Date(2026, 9, 10)); // 10.10.2026.
  assert.deepEqual(p.this_month, { from: "2026-10-01", to: "2026-10-10" });
  assert.deepEqual(p.last_month, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(p.last_90, { from: "2026-07-13", to: "2026-10-10" }); // 90 dana uključujući danas
  const jan = periodPresets(new Date(2026, 0, 15));
  assert.deepEqual(jan.last_month, { from: "2025-12-01", to: "2025-12-31" }); // prelaz godine
  assert.deepEqual(periodPresets(new Date(2026, 2, 1)).last_month, { from: "2026-02-01", to: "2026-02-28" });
});
ok("dugmići ishoda: Aktivne = svi otvoreni statusi, Zatvorene, Odbijene", () => {
  assert.deepEqual(OUTCOME_STATUSES.closed, ["zatvorena"]);
  assert.deepEqual(OUTCOME_STATUSES.rejected, ["odbijena"]);
  assert.ok(OUTCOME_STATUSES.active.includes("u_nabavci") && !OUTCOME_STATUSES.active.includes("zatvorena") && !OUTCOME_STATUSES.active.includes("odbijena"));
  assert.equal(OUTCOME_STATUSES.active, OPEN_STATUSES);
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

// --- Prikaz "sve narudžbine": pažnja na vrhu, ostalo po datumu kreiranja, do praga učitane ture ---
const mk = (id, status, createdAgoH, extra = {}) => ({ id, status, priority: "standardno", createdAt: ts(createdAgoH * H), ...extra });
ok("PAGE_SIZE je 30", () => assert.equal(PAGE_SIZE, 30));
ok("allViewList: pažnja uvek na vrhu, i kad je starija od praga ture", () => {
  const orders = [mk("a", "zatvorena", 1), mk("b", "isporucena", 500), mk("c", "zatvorena", 2), mk("d", "zatvorena", 100)];
  const res = allViewList(orders, { floorMs: now - 10 * H, isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  assert.deepEqual(res.map((o) => o.id), ["b", "a", "c"]); // "d" je ispod praga (još nije učitana tura)
});
ok("allViewList: ostalo je po datumu kreiranja (otvorene i zatvorene izmešano), najnovije prve", () => {
  const orders = [mk("a", "zatvorena", 5), mk("b", "u_nabavci", 3), mk("c", "odbijena", 1), mk("d", "prihvacena", 4)];
  const res = allViewList(orders, { floorMs: -Infinity, isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  assert.deepEqual(res.map((o) => o.id), ["c", "b", "d", "a"]);
});
ok("allViewList: sa floorMs = -Infinity prikazano je tačno onoliko koliko ih ima (nema ostatka)", () => {
  const orders = Array.from({ length: 37 }, (_, i) => mk(`o${i}`, i % 3 ? "zatvorena" : "u_nabavci", i + 1));
  const res = allViewList(orders, { floorMs: -Infinity, isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  assert.equal(res.length, 37);
});
ok("allViewList: sledeća tura samo dodaje redove na kraj (prvih N ostaje isto)", () => {
  const all = Array.from({ length: 70 }, (_, i) => mk(`o${i}`, "zatvorena", i + 1));
  const floorAfter = (n) => toMillis(all[n - 1].createdAt);
  const first = allViewList(all.slice(0, 30), { floorMs: floorAfter(30), isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  const second = allViewList(all.slice(0, 60), { floorMs: floorAfter(60), isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  assert.equal(first.length, 30); assert.equal(second.length, 60);
  assert.deepEqual(second.slice(0, 30).map((o) => o.id), first.map((o) => o.id));
});
ok("allViewList: narudžbina bez createdAt (tek kreirana, čeka server) računa se kao najnovija", () => {
  const res = allViewList([mk("a", "zatvorena", 1), { id: "n", status: "prihvacena" }], { floorMs: now - 2 * H, isAttention: isAttentionNarucilac, compare: compareNarucilac, now });
  assert.equal(res[0].id, "n");
});

ok("orderNumberPrefix: veliko slovo, dopuna 'NAR-', delimičan unos prefiksa", () => {
  assert.equal(orderNumberPrefix("nar-20261010-37/26"), "NAR-20261010-37/26");
  assert.equal(orderNumberPrefix(" 202610 "), "NAR-202610");
  assert.equal(orderNumberPrefix("na"), "NA");
  assert.equal(orderNumberPrefix("nar-"), "NAR-");
  assert.equal(orderNumberPrefix(""), "");
});

console.log(`\n${n} testova prošlo.`);
