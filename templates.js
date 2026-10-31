// ============================================================================
// ŠABLONI, OMILJENE LISTE I PONAVLJAJUĆE NARUDŽBINE — Poglavlje 7
// type: 'sablon' | 'omiljena_lista' | 'ponavljajuca'
// ============================================================================
import { db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, where, query, serverTimestamp } from "./firebase-init.js";
import { logAudit } from "./audit.js";

const templatesCol = (companyId) => collection(db, "companies", companyId, "templates");

// items: [{supplierId, supplierName, productId, productName, code, unit, quantity, note}]
export async function saveTemplate(companyId, { name, type, items, ownerUid, ownerScope = "lokacija",
  recurringDays = [], recurringLocationId = null, actorName }) {
  const ref = await addDoc(templatesCol(companyId), {
    name, type, items, ownerUid, ownerScope, recurringDays, recurringLocationId,
    createdAt: serverTimestamp(),
  });
  await logAudit(companyId, { action: "template_created", entity: "Templates", entityId: ref.id, actorName, details: `${name} (${type})` });
  return ref.id;
}

export function updateTemplate(companyId, id, data) {
  return updateDoc(doc(db, "companies", companyId, "templates", id), data);
}
export function deleteTemplate(companyId, id) {
  return deleteDoc(doc(db, "companies", companyId, "templates", id));
}

export async function getTemplates(companyId, type = null) {
  const q = type
    ? query(templatesCol(companyId), where("type", "==", type), orderBy("name"))
    : query(templatesCol(companyId), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenTemplates(companyId, callback, type = null) {
  const q = type
    ? query(templatesCol(companyId), where("type", "==", type), orderBy("name"))
    : query(templatesCol(companyId), orderBy("name"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Provera da li ponavljajuću narudžbinu treba danas pokrenuti (npr. pon/sre/pet)
export function isDueToday(template) {
  if (template.type !== "ponavljajuca" || !template.recurringDays?.length) return false;
  const dayNames = ["ned", "pon", "uto", "sre", "cet", "pet", "sub"];
  const today = dayNames[new Date().getDay()];
  return template.recurringDays.includes(today);
}
