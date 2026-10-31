// ============================================================================
// KATALOG PROIZVODA (Categories + SupProducts) — Poglavlje 8.1
// ============================================================================
import { db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, query, where, serverTimestamp } from "./firebase-init.js";
import { logAudit } from "./audit.js";

const categoriesCol = (companyId) => collection(db, "companies", companyId, "categories");
const productsCol = (companyId, supplierId) => collection(db, "companies", companyId, "suppliers", supplierId, "products");

// --- Kategorije (zajedničke za sve dobavljače, admin-only — vidi firestore.rules) ---
export async function addCategory(companyId, name) {
  const ref = await addDoc(categoriesCol(companyId), { name, createdAt: serverTimestamp() });
  return ref.id;
}
export function deleteCategory(companyId, id) {
  return deleteDoc(doc(db, "companies", companyId, "categories", id));
}
export async function getCategories(companyId) {
  const snap = await getDocs(query(categoriesCol(companyId), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Proizvodi dobavljača (naziv, šifra, barkod, JM, kategorija, slika, PDV, min. količina) ---
export async function addProduct(companyId, supplierId, {
  name, code = "", barcode = "", unit = "kom", categoryId = "", imageUrl = "",
  vatRate = 20, minQuantity = 1, actorName, createdBy, source = "manual",
}) {
  const ref = await addDoc(productsCol(companyId, supplierId), {
    name, code, barcode, unit, categoryId, imageUrl, vatRate, minQuantity,
    active: true, createdAt: serverTimestamp(), createdBy: createdBy || null, source,
  });
  await logAudit(companyId, { action: "product_created", entity: "SupProducts", entityId: ref.id, actorName, details: name });
  return ref.id;
}
export function updateProduct(companyId, supplierId, productId, data) {
  return updateDoc(doc(db, "companies", companyId, "suppliers", supplierId, "products", productId), data);
}

// Masovna izmena zajedničkih polja (kategorija, JM, PDV, min. količina...) za više
// izabranih proizvoda odjednom — vidi "Katalog — masovna izmena" u admin-catalog.js.
// items: [{ id, name }] (name samo radi audit loga); data: polja koja se menjaju kod SVIH.
export async function bulkUpdateProducts(companyId, supplierId, items, data, actorName) {
  await Promise.all(items.map((item) =>
    updateDoc(doc(db, "companies", companyId, "suppliers", supplierId, "products", item.id), data)
  ));
  await logAudit(companyId, {
    action: "products_bulk_updated", entity: "SupProducts", entityId: supplierId, actorName,
    details: `${items.length} × ${items.map((i) => i.name).join(", ")}`,
  });
}

// --- Brisanje i pasivizacija proizvoda ---
// Proizvod je "aktivan" osim ako je active === false (stari zapisi bez polja važe kao aktivni).
// Pasivizirani proizvod ostaje u katalogu (i veza sa starim narudžbenicama), ali se ne nudi
// pri kreiranju novih narudžbenica — vidi getProducts(..., { activeOnly: true }).
export const isProductActive = (p) => p.active !== false;

const productRef = (companyId, supplierId, productId) =>
  doc(db, "companies", companyId, "suppliers", supplierId, "products", productId);

// Izvršava operaciju nad više proizvoda; u audit upisuje SAMO one koji su uspeli, pa se
// log ne razilazi sa stvarnim stanjem ako neko brisanje/izmena padne (npr. nedostaju prava).
async function runBulk(companyId, supplierId, items, op, action, actorName, actorUid) {
  const results = await Promise.allSettled(items.map((item) => op(productRef(companyId, supplierId, item.id))));
  const done = items.filter((_, i) => results[i].status === "fulfilled");
  if (done.length) {
    await logAudit(companyId, {
      action, entity: "SupProducts", entityId: supplierId, actorUid, actorName,
      details: `${done.length} × ${done.map((i) => i.name).join(", ")}`,
    });
  }
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  return done.length;
}

export async function deleteProduct(companyId, supplierId, productId, { name = "", actorName = null, actorUid = null } = {}) {
  await deleteDoc(productRef(companyId, supplierId, productId));
  await logAudit(companyId, { action: "product_deleted", entity: "SupProducts", entityId: productId, actorUid, actorName, details: name });
}
// items: [{ id, name }]
export function bulkDeleteProducts(companyId, supplierId, items, { actorName = null, actorUid = null } = {}) {
  return runBulk(companyId, supplierId, items, (ref) => deleteDoc(ref), "products_bulk_deleted", actorName, actorUid);
}

export async function setProductActive(companyId, supplierId, productId, active, { name = "", actorName = null, actorUid = null } = {}) {
  await updateDoc(productRef(companyId, supplierId, productId), { active });
  await logAudit(companyId, {
    action: active ? "product_activated" : "product_deactivated", entity: "SupProducts", entityId: productId, actorUid, actorName, details: name,
  });
}
export function bulkSetProductsActive(companyId, supplierId, items, active, { actorName = null, actorUid = null } = {}) {
  return runBulk(companyId, supplierId, items, (ref) => updateDoc(ref, { active }),
    active ? "products_bulk_activated" : "products_bulk_deactivated", actorName, actorUid);
}

// activeOnly: true → bez pasiviziranih (za kreiranje/izmenu narudžbina); katalog admin strana vidi sve.
export async function getProducts(companyId, supplierId, { activeOnly = false } = {}) {
  const snap = await getDocs(query(productsCol(companyId, supplierId), orderBy("name")));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return activeOnly ? list.filter(isProductActive) : list;
}
export function listenProducts(companyId, supplierId, callback) {
  return onSnapshot(query(productsCol(companyId, supplierId), orderBy("name")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Pametna pretraga — Poglavlje 7.4 (delimično podudaranje pojmova, client-side filter)
export function smartSearch(items, term, field = "name") {
  const t = term.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) => (i[field] || "").toLowerCase().includes(t));
}
