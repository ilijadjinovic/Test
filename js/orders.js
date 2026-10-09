// ============================================================================
// NARUDŽBINE (Orders + OrderItems) — Poglavlje 3, 4, 5
// ============================================================================
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot,
  orderBy, where, query, limit, serverTimestamp, writeBatch, increment,
  runTransaction, storage, ref, deleteObject, startAfter, Timestamp,
} from "./firebase-init.js";
import { ORDER_STATUS, DELIVERY_LOCATION_STATUS, statusLabel, uid } from "./utils.js";
import { OPEN_STATUSES, SEARCH_CAP, buildSearchFields } from "./dash-logic.js";
import { logAudit } from "./audit.js";
import { createNotification, NOTIF_EVENTS } from "./notifications.js";
import { getIsporucioci } from "./users.js";

const ordersCol = (companyId) => collection(db, "companies", companyId, "orders");
const itemsCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "items");
const deliveryLocCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "deliveryLocations");
const purchasesCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "purchases");

// Statusi koji se računaju kao "aktivna" narudžbina kod brojanja opterećenja isporučioca
const ACTIVE_DELIVERY_STATUSES = [
  ORDER_STATUS.CEKA_PRIHVATANJE, ORDER_STATUS.PRIHVACENA, ORDER_STATUS.U_NABAVCI,
  ORDER_STATUS.ZAVRSENA_NABAVKA, ORDER_STATUS.U_ISPORUCI, ORDER_STATUS.ISPORUCENA,
];

// Bira isporučioca sa najmanje trenutno aktivnih (nezavršenih) narudžbina — Poglavlje 4.2 "automatski"
async function pickAvailableIsporucilac(companyId) {
  const isporucioci = await getIsporucioci(companyId);
  if (!isporucioci.length) return null;
  if (isporucioci.length === 1) return isporucioci[0];

  // Firestore ne dozvoljava dva "in" filtera u istom upitu, pa se broji preko jednog
  // upita po statusu, a raspodela po isporučiocu se radi na klijentu.
  const snap = await getDocs(query(ordersCol(companyId), where("status", "in", ACTIVE_DELIVERY_STATUSES)));
  const counts = Object.fromEntries(isporucioci.map((u) => [u.uid, 0]));
  snap.docs.forEach((d) => {
    const assignedToUid = d.data().assignedToUid;
    if (assignedToUid && assignedToUid in counts) counts[assignedToUid] += 1;
  });

  let chosen = isporucioci[0];
  for (const u of isporucioci) {
    if (counts[u.uid] < counts[chosen.uid]) chosen = u;
  }
  return chosen;
}

// Format broja narudžbenice: NAR-GGGGMMDD-RB/GG
//   GGGGMMDD = datum kreiranja (npr. 20260726)
//   RB       = redni broj narudžbenice u tekućoj godini (kreće od 1, resetuje se 1.1.)
//   GG       = poslednje dve cifre godine (npr. 26 za 2026.)
// Redni broj se čuva po firmi (companyId) i po godini u dokumentu
// companies/{companyId}/counters/orders_{godina}, a uvećava se atomski
// preko Firestore transakcije da ne bi dve istovremene narudžbine dobile isti broj.
async function getNextOrderNumber(companyId) {
  const now = new Date();
  const godina = now.getFullYear();
  const gg = String(godina).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datum = `${godina}${mm}${dd}`;

  const counterRef = doc(db, "companies", companyId, "counters", `orders_${godina}`);

  const redniBroj = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const trenutno = snap.exists() ? (snap.data().count || 0) : 0;
    const sledeci = trenutno + 1;
    transaction.set(counterRef, { count: sledeci, godina, updatedAt: serverTimestamp() });
    return sledeci;
  });

  return `NAR-${datum}-${redniBroj}/${gg}`;
}

// items: [{supplierId, supplierName, productId, productName, code, unit, quantity, note, priority, pickupLocationId}]
// deliveryLocations: [{locationId, locationName, itemProductIds:[...]}]
// requestedByName: slobodan tekst — ko je (koja osoba/inženjer) tražio robu iz ove
// narudžbine. Odvojeno od createdByName, koji je uvek naručilac što je uneo
// narudžbinu u sistem — vidi napomenu "za koga je narudžbina" (Poglavlje 2.1).
export async function createOrder(companyId, {
  createdByUid, createdByName, priority, items, deliveryLocations, assignmentMode, recurring = null,
  requestedByName = "",
  // assignTo: { uid, name } — direktno dodeli isporučiocu (npr. kod "Ponovi narudžbinu")
  // extraFields: dodatna polja koja se upisuju na narudžbinu (npr. repeatOfOrderId)
  assignTo = null, extraFields = {},
}) {
  const orderNumber = await getNextOrderNumber(companyId);

  let status = assignmentMode === "narucilac_bira" ? ORDER_STATUS.KREIRANA : ORDER_STATUS.CEKA_PRIHVATANJE;
  let assignedToUid = null, assignedToName = null;

  if (assignmentMode === "automatski") {
    const chosen = await pickAvailableIsporucilac(companyId);
    if (chosen) {
      assignedToUid = chosen.uid;
      assignedToName = chosen.name;
    }
    // Ako nema nijednog aktivnog isporučioca u firmi, narudžbina ostaje nedodeljena
    // (status i dalje CEKA_PRIHVATANJE) i Admin je može ručno dodeliti kasnije.
  }

  if (assignTo?.uid) {
    assignedToUid = assignTo.uid;
    assignedToName = assignTo.name || null;
    status = ORDER_STATUS.CEKA_PRIHVATANJE;
  }

  const cleanRequestedBy = (requestedByName || "").trim();
  // Polja za pretragu i prikaz u tabelama (nazivi artikala, dobavljača i lokacija)
  const searchFields = buildSearchFields(
    { orderNumber, createdByName, assignedToName, requestedByName: cleanRequestedBy }, items, deliveryLocations,
  );

  const orderRef = await addDoc(ordersCol(companyId), {
    orderNumber, createdByUid, createdByName, priority,
    requestedByName: cleanRequestedBy,
    status,
    assignedToUid, assignedToName,
    // assignedAt: od ovog trenutka se računa kašnjenje (hitno 2h, standardno 24h)
    assignedAt: assignedToUid ? serverTimestamp() : null,
    supplierIds: [...new Set(items.map((i) => i.supplierId))],
    itemCount: items.length, recurring,
    ...searchFields,
    ...extraFields,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);

  // Lokacije isporuke se upisuju PRVE, u sopstvenu podkolekciju narudžbine —
  // svaki dokument dobija NOVI (Firestore-generisani) ID, različit od
  // "loc.locationId" (koji je ID iz firmine matične liste lokacija). Zato se
  // pravi mapa staro-ID -> novo-ID, pa se njome niže preslikava
  // "item.deliveryLocationId" na stvarni ID podkolekcije ove narudžbine —
  // u suprotnom bi ekran narudžbine (page-order-detail.js) upoređivao
  // item.deliveryLocationId sa ID-jevima podkolekcije koji mu ne odgovaraju,
  // pa se izabrana lokacija isporuke po artiklu ne bi prikazala kao selektovana
  // (iako je ispravno sačuvano ime i ispravno se štampa na PDF-u).
  const locationIdMap = {};
  deliveryLocations.forEach((loc) => {
    const locRef = doc(deliveryLocCol(companyId, orderRef.id));
    if (loc.locationId) locationIdMap[loc.locationId] = locRef.id;
    batch.set(locRef, { ...loc, status: "ceka", createdAt: serverTimestamp() });
  });

  items.forEach((item) => {
    const itemRef = doc(itemsCol(companyId, orderRef.id));
    const mappedDeliveryLocationId = item.deliveryLocationId && item.deliveryLocationId !== "any"
      ? (locationIdMap[item.deliveryLocationId] || item.deliveryLocationId)
      : (item.deliveryLocationId || "any");
    batch.set(itemRef, {
      ...item, deliveryLocationId: mappedDeliveryLocationId,
      purchaseStatus: "na_cekanju", purchasedQty: 0, substituteName: "",
      createdAt: serverTimestamp(),
    });
  });
  // Jedna "nabavka" (Purchase) po dobavljaču — Poglavlje 5.1
  const bySupplier = {};
  items.forEach((i) => { (bySupplier[i.supplierId] ||= { supplierId: i.supplierId, supplierName: i.supplierName, count: 0 }).count += 1; });
  Object.values(bySupplier).forEach((p) => {
    const pRef = doc(purchasesCol(companyId, orderRef.id));
    batch.set(pRef, { ...p, status: "ceka", createdAt: serverTimestamp() });
  });
  await batch.commit();

  if (assignedToUid) {
    await createNotification(companyId, {
      toUid: assignedToUid, event: NOTIF_EVENTS.NOVA_NARUDZBINA, orderId: orderRef.id,
      titleKey: "notif_new_order_title", bodyKey: "notif_new_order_auto_body",
    });
  }

  await logAudit(companyId, { action: "order_created", entity: "Orders", entityId: orderRef.id, actorUid: createdByUid, actorName: createdByName, details: orderNumber });
  return orderRef.id;
}

export async function getOrder(companyId, orderId) {
  const snap = await getDoc(doc(db, "companies", companyId, "orders", orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenOrder(companyId, orderId, callback) {
  return onSnapshot(doc(db, "companies", companyId, "orders", orderId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function getOrderItems(companyId, orderId) {
  const snap = await getDocs(query(itemsCol(companyId, orderId), orderBy("supplierName")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenOrderItems(companyId, orderId, callback) {
  return onSnapshot(query(itemsCol(companyId, orderId), orderBy("supplierName")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function getOrderDeliveryLocations(companyId, orderId) {
  const snap = await getDocs(deliveryLocCol(companyId, orderId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenDeliveryLocations(companyId, orderId, callback) {
  return onSnapshot(deliveryLocCol(companyId, orderId), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getOrderPurchases(companyId, orderId) {
  const snap = await getDocs(purchasesCol(companyId, orderId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenOrderPurchases(companyId, orderId, callback) {
  return onSnapshot(purchasesCol(companyId, orderId), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// --- Liste narudžbina po ulozi ---
export function listenMyOrders(companyId, createdByUid, callback, max = 100) {
  const q = query(ordersCol(companyId), where("createdByUid", "==", createdByUid), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenAssignedOrders(companyId, assignedToUid, callback, max = 100) {
  const q = query(ordersCol(companyId), where("assignedToUid", "==", assignedToUid), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenAllOrders(companyId, callback, max = 200) {
  const q = query(ordersCol(companyId), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function listenUnassignedOrders(companyId, callback) {
  const q = query(ordersCol(companyId), where("status", "==", ORDER_STATUS.KREIRANA), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// --- Dodela isporučioca — Poglavlje 4.2 ---
export async function assignOrder(companyId, orderId, { assignedToUid, assignedToName, actorName }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), {
    assignedToUid, assignedToName, assignedAt: serverTimestamp(),
    status: ORDER_STATUS.CEKA_PRIHVATANJE, updatedAt: serverTimestamp(),
  });
  await safeRefreshSearchData(companyId, orderId);
  await logAudit(companyId, { action: "order_assigned", entity: "Orders", entityId: orderId, actorName, details: assignedToName });
  await createNotification(companyId, { toUid: assignedToUid, event: NOTIF_EVENTS.NOVA_NARUDZBINA, orderId, titleKey: "notif_new_order_title", bodyKey: "notif_new_order_manual_body" });
}

// --- Brisanje cele narudžbine (Poglavlje "pogrešno kreirana/poslata narudžbina") ---
// Dozvole: proveravaju se na nivou firestore.rules (canDeleteOrder) — admin sme
// da obriše bilo koju narudžbinu u bilo kom trenutku; naručilac sme da obriše
// SAMO svoju narudžbinu dok je u statusu "kreirana" ili "čeka_prihvatanje"
// (pre nego što je isporučilac prihvati). Brišemo prvo sve podkolekcije, pa tek
// onda glavni dokument narudžbine — jer pravila za podkolekcije proveravaju
// stanje narudžbine preko get(), koji mora da nađe dokument narudžbine.
const ORDER_SUBCOLLECTIONS = ["items", "purchases", "deliveryLocations", "claims", "messages", "attachments"];

export async function deleteOrder(companyId, orderId, { actorUid, actorName, orderNumber }) {
  // Prvo obriši stvarne fajlove priloga iz Storage-a (Firestore delete ne čisti Storage automatski)
  const attachmentsSnap = await getDocs(collection(db, "companies", companyId, "orders", orderId, "attachments"));
  await Promise.all(attachmentsSnap.docs.map(async (d) => {
    const path = d.data().path;
    if (!path) return;
    try { await deleteObject(ref(storage, path)); } catch { /* fajl možda već ne postoji — ignoriši */ }
  }));

  for (const sub of ORDER_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, "companies", companyId, "orders", orderId, sub));
    if (!snap.docs.length) continue;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await logAudit(companyId, { action: "order_deleted", entity: "Orders", entityId: orderId, actorUid, actorName, details: orderNumber });
  await deleteDoc(doc(db, "companies", companyId, "orders", orderId));
}

// --- Prihvatanje / odbijanje — Poglavlje 2.4, 4.3 ---
// Napomena (racionalizacija klikova, tačka A): prihvatanje narudžbine odmah
// pokreće nabavku kod svih dobavljača (status narudžbine ide direktno na
// u_nabavci, a svaka Purchase odmah na "u_toku") — isporučilac više ne mora
// da klikne posebno "Započni nabavku" za svakog dobavljača ponaosob.
export async function acceptOrder(companyId, orderId, { actorUid, actorName, orderCreatedByUid }) {
  const orderRef = doc(db, "companies", companyId, "orders", orderId);
  const purchasesSnap = await getDocs(purchasesCol(companyId, orderId));

  const batch = writeBatch(db);
  batch.update(orderRef, { status: ORDER_STATUS.U_NABAVCI, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  purchasesSnap.docs.forEach((d) => {
    batch.update(d.ref, { status: "u_toku", startedAt: serverTimestamp() });
  });
  await batch.commit();

  await logAudit(companyId, { action: "order_accepted", entity: "Orders", entityId: orderId, actorUid, actorName });
  await createNotification(companyId, { toUid: orderCreatedByUid, event: NOTIF_EVENTS.NARUDZBINA_PRIHVACENA, orderId, titleKey: "notif_order_accepted_title", bodyKey: "notif_order_accepted_body", bodyParams: { name: actorName } });
}

export async function rejectOrder(companyId, orderId, { reason, actorUid, actorName, orderCreatedByUid }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.ODBIJENA, rejectionReason: reason, closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logAudit(companyId, { action: "order_rejected", entity: "Orders", entityId: orderId, actorUid, actorName, details: reason });
  await createNotification(companyId, { toUid: orderCreatedByUid, event: NOTIF_EVENTS.NARUDZBINA_ODBIJENA, orderId, titleKey: "notif_order_rejected_title", bodyKey: "notif_order_rejected_body", bodyParams: { reason } });
}

// --- Generički prelazak statusa (koristi se za u_nabavci, zavrsena_nabavka, u_isporuci, isporucena) ---
export async function setOrderStatus(companyId, orderId, status, { actorName, actorUid, extra = {} } = {}) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status, updatedAt: serverTimestamp(), ...extra });
  await logAudit(companyId, { action: "order_status_changed", entity: "Orders", entityId: orderId, actorUid, actorName, details: statusLabel(status) });
}

// --- Naručilac menja narudžbinu dok nije prihvaćena (Poglavlje 2.3) ---
// Napomena: sve funkcije ispod su namerno dozvoljene samo dok je status
// KREIRANA ili CEKA_PRIHVATANJE — tu proveru radi UI (page-order-detail.js,
// canEdit), isto kao i za ostale akcije u ovom fajlu (assign/accept/reject...).
// Ovde se doda i itemCount na narudžbini ažurira pri svakoj izmeni broja
// stavki, jer se on koristi u izveštajima (Poglavlje "Broj artikala").
export async function updateOrderItem(companyId, orderId, itemId, data) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId), data);
  // nazivi/šifre/dobavljači ulaze u pretragu — ostala polja (količine, nabavka) ne
  if (Object.keys(data).some((k) => ["productName", "supplierName", "code", "substituteName"].includes(k))) {
    await safeRefreshSearchData(companyId, orderId);
  }
}
export async function deleteOrderItem(companyId, orderId, itemId) {
  await deleteDoc(doc(db, "companies", companyId, "orders", orderId, "items", itemId));
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { itemCount: increment(-1), updatedAt: serverTimestamp() });
  await safeRefreshSearchData(companyId, orderId);
}
export async function addOrderItem(companyId, orderId, item) {
  const ref = await addDoc(itemsCol(companyId, orderId), { ...item, purchaseStatus: "na_cekanju", purchasedQty: 0, substituteName: "", createdAt: serverTimestamp() });
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { itemCount: increment(1), updatedAt: serverTimestamp() });
  await safeRefreshSearchData(companyId, orderId);
  return ref.id;
}

// --- Prioritet narudžbine — narucilac može promeniti dok nije prihvaćena ---
export async function updateOrderPriority(companyId, orderId, priority, { actorUid, actorName } = {}) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { priority, updatedAt: serverTimestamp() });
  await logAudit(companyId, { action: "order_priority_changed", entity: "Orders", entityId: orderId, actorUid, actorName, details: priority });
}

// --- "Ko je tražio" — narucilac može promeniti dok nije prihvaćena ---
export async function updateOrderRequestedBy(companyId, orderId, requestedByName, { actorUid, actorName } = {}) {
  const value = (requestedByName || "").trim();
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { requestedByName: value, updatedAt: serverTimestamp() });
  await safeRefreshSearchData(companyId, orderId);
  await logAudit(companyId, { action: "order_requested_by_changed", entity: "Orders", entityId: orderId, actorUid, actorName, details: value || "—" });
}

// Poslednjih N različitih imena unetih u polje "ko je tražio" — koristi se za
// autocomplete (datalist) pri kreiranju nove narudžbine, da se izbegnu tipfeleri
// i različiti zapisi istog imena (npr. "Marko" vs "M. Petrović").
export async function getRecentRequesterNames(companyId, max = 300) {
  const snap = await getDocs(query(ordersCol(companyId), orderBy("createdAt", "desc"), limit(max)));
  const names = new Set();
  snap.docs.forEach((d) => {
    const name = (d.data().requestedByName || "").trim();
    if (name) names.add(name);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, "sr"));
}

// --- Lokacije isporuke narudžbine — dodavanje/uklanjanje dok nije prihvaćena ---
export async function addOrderDeliveryLocation(companyId, orderId, { locationId, locationName }) {
  const ref = await addDoc(deliveryLocCol(companyId, orderId), { locationId, locationName, status: "ceka", createdAt: serverTimestamp() });
  await safeRefreshSearchData(companyId, orderId);
  return ref.id;
}
export async function removeOrderDeliveryLocation(companyId, orderId, locId) {
  await deleteDoc(doc(db, "companies", companyId, "orders", orderId, "deliveryLocations", locId));
  await safeRefreshSearchData(companyId, orderId);
}

// --- Potvrda prijema + auto-prenos nedostajuće robe u sledeću nabavku (Poglavlje 6) ---
// Jedan upis: narudžbina odmah ide na "zatvorena" (ranije su bila dva upisa —
// prvo "potvrdjen_prijem", pa "zatvorena" — i ako drugi padne, narudžbina je
// ostajala u prelaznom statusu koji nijedna kartica ne prati). Status
// "potvrdjen_prijem" ostaje u šifrarniku samo zbog starih podataka.
export async function confirmReceipt(companyId, orderId, { actorUid, actorName, missingItemsToCarryOver = [] }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), {
    status: ORDER_STATUS.ZATVORENA, confirmedAt: serverTimestamp(), closedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await logAudit(companyId, { action: "order_status_changed", entity: "Orders", entityId: orderId, actorUid, actorName, details: statusLabel(ORDER_STATUS.POTVRDJEN_PRIJEM) });
  await createNotification(companyId, { toUid: null, event: NOTIF_EVENTS.PRIJEM_POTVRDJEN, orderId, titleKey: "notif_receipt_confirmed_title", bodyKey: "notif_receipt_confirmed_body" });

  // Ako postoje nedostajuće stavke i naručilac je izabrao "Da" — kreira se nova narudžbina
  if (missingItemsToCarryOver.length) {
    const order = await getOrder(companyId, orderId);
    const deliveryLocations = await getOrderDeliveryLocations(companyId, orderId);
    return createOrder(companyId, {
      createdByUid: order.createdByUid, createdByName: order.createdByName, priority: "standardno",
      requestedByName: order.requestedByName || "",
      items: missingItemsToCarryOver, deliveryLocations: deliveryLocations.map((l) => ({ locationId: l.id, locationName: l.locationName })),
      assignmentMode: "admin_bira",
    });
  }
  return null;
}

// Brza potvrda iz tabele: sva roba je primljena u celosti — zatvara narudžbinu i
// potvrđuje sve lokacije isporuke (isto što detalji rade kad nema manjka).
export async function confirmReceiptFull(companyId, orderId, { actorUid, actorName }) {
  const locations = await getOrderDeliveryLocations(companyId, orderId);
  await confirmReceipt(companyId, orderId, { actorUid, actorName, missingItemsToCarryOver: [] });
  const pending = locations.filter((l) => l.status !== DELIVERY_LOCATION_STATUS.POTVRDJENO);
  if (pending.length) {
    const batch = writeBatch(db);
    pending.forEach((l) => batch.update(doc(deliveryLocCol(companyId, orderId), l.id), { status: DELIVERY_LOCATION_STATUS.POTVRDJENO, confirmedAt: serverTimestamp() }));
    await batch.commit();
    await Promise.all(pending.map((l) => logAudit(companyId, { action: "delivery_location_confirmed", entity: "DeliveryLocations", entityId: l.id, actorName })));
  }
}

// --- "Ponovi narudžbinu" posle odbijanja ---------------------------------------
// Pravi NOVU narudžbinu sa istim stavkama, lokacijama, prioritetom i "ko je
// tražio", dodeljenu istom isporučiocu koji je odbio. Originalna odbijena
// narudžbina ostaje u istoriji (sa razlogom) i dobija oznaku repeatedAsOrderId,
// pa dugme više ne nudi ponovni unos (nema dupliranja).
const REPEAT_ITEM_FIELDS = [
  "supplierId", "supplierName", "productId", "productName", "code", "unit", "quantity", "note", "priority",
  "pickupLocationId", "pickupLocationName", "deliveryLocationId", "deliveryLocationName",
];
export async function repeatOrderAfterRejection(companyId, orderId, { actorUid, actorName }) {
  const order = await getOrder(companyId, orderId);
  if (!order) throw new Error("order_not_found");
  if (order.status !== ORDER_STATUS.ODBIJENA) throw new Error("order_not_rejected");
  if (order.repeatedAsOrderId) throw new Error("already_repeated");

  const [items, locations] = await Promise.all([getOrderItems(companyId, orderId), getOrderDeliveryLocations(companyId, orderId)]);
  // item.deliveryLocationId je ID podkolekcije stare narudžbine; createOrder očekuje
  // ID iz matične liste lokacija (locationId) i sam ga preslikava na nove dokumente.
  const subToMaster = Object.fromEntries(locations.map((l) => [l.id, l.locationId]));
  const newItems = items.map((it) => {
    const clean = {};
    REPEAT_ITEM_FIELDS.forEach((k) => { if (it[k] !== undefined) clean[k] = it[k]; });
    if (clean.deliveryLocationId && subToMaster[clean.deliveryLocationId]) clean.deliveryLocationId = subToMaster[clean.deliveryLocationId];
    return clean;
  });
  const newLocations = locations.map((l) => ({ locationId: l.locationId, locationName: l.locationName, ...(l.itemProductIds ? { itemProductIds: l.itemProductIds } : {}) }));

  const newId = await createOrder(companyId, {
    createdByUid: order.createdByUid, createdByName: order.createdByName, priority: order.priority || "standardno",
    requestedByName: order.requestedByName || "",
    items: newItems, deliveryLocations: newLocations,
    assignmentMode: "admin_bira",
    assignTo: order.assignedToUid ? { uid: order.assignedToUid, name: order.assignedToName } : null,
    extraFields: { repeatOfOrderId: orderId, repeatOfNumber: order.orderNumber },
  });
  const created = await getOrder(companyId, newId);
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), {
    repeatedAsOrderId: newId, repeatedAsNumber: created?.orderNumber || "", updatedAt: serverTimestamp(),
  });
  await logAudit(companyId, { action: "order_repeated", entity: "Orders", entityId: orderId, actorUid, actorName, details: created?.orderNumber || "" });
  return { id: newId, orderNumber: created?.orderNumber || "" };
}

// --- Polja za pretragu (searchText, supplierNames, deliveryLocationNames) -----
export async function refreshOrderSearchData(companyId, orderId) {
  const orderRef = doc(db, "companies", companyId, "orders", orderId);
  const [snap, items, locations] = await Promise.all([getDoc(orderRef), getOrderItems(companyId, orderId), getOrderDeliveryLocations(companyId, orderId)]);
  if (!snap.exists()) return;
  await updateDoc(orderRef, buildSearchFields(snap.data(), items, locations));
}
// Greška pri osvežavanju pretrage ne sme da obori glavnu akciju (npr. dodelu).
async function safeRefreshSearchData(companyId, orderId) {
  try { await refreshOrderSearchData(companyId, orderId); } catch (e) { console.error("Osvežavanje polja za pretragu nije uspelo:", e); }
}

// --- Liste za kontrolne table naručioca i isporučioca -------------------------
// field: "createdByUid" (naručilac) ili "assignedToUid" (isporučilac).
// Tri izvora: (1) otvorene narudžbine — uživo, (2) zatvorene/odbijene u poslednjih
// RECENT_DAYS dana — uživo, (3) starije zatvorene — po stranama na zahtev.
const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function listenOpenOrdersBy(companyId, field, value, callback, onError) {
  const q = query(ordersCol(companyId), where(field, "==", value), where("status", "in", OPEN_STATUSES));
  return onSnapshot(q, (snap) => callback(mapDocs(snap)), onError);
}
export function listenRecentClosedBy(companyId, field, value, sinceDate, callback, onError) {
  const q = query(ordersCol(companyId), where(field, "==", value), where("closedAt", ">=", Timestamp.fromDate(sinceDate)), orderBy("closedAt", "desc"));
  return onSnapshot(q, (snap) => callback(mapDocs(snap)), onError);
}
export async function getOlderClosedPageBy(companyId, field, value, beforeDate, cursorDoc, size = 25) {
  const parts = [where(field, "==", value), where("closedAt", "<", Timestamp.fromDate(beforeDate)), orderBy("closedAt", "desc")];
  if (cursorDoc) parts.push(startAfter(cursorDoc));
  parts.push(limit(size));
  const snap = await getDocs(query(ordersCol(companyId), ...parts));
  return { orders: mapDocs(snap), cursor: snap.docs[snap.docs.length - 1] || null, hasMore: snap.docs.length === size };
}
// Cela istorija jednog korisnika (za pretragu) — po 500, do SEARCH_CAP.
export async function getAllOrdersBy(companyId, field, value, cap = SEARCH_CAP) {
  const out = [];
  let cursor = null;
  while (out.length < cap) {
    const parts = [where(field, "==", value), orderBy("createdAt", "desc")];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(500));
    const snap = await getDocs(query(ordersCol(companyId), ...parts));
    out.push(...mapDocs(snap));
    if (snap.docs.length < 500) return { orders: out, capped: false };
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { orders: out, capped: true };
}
