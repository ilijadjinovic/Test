// ============================================================================
// MASTER ADMIN — Poglavlje 2.1: uvid u sve firme, blokiranje, brisanje,
// globalna statistika, upravljanje pretplatama, sistemska podešavanja
// ============================================================================
import { db, collection, doc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, query, collectionGroup, serverTimestamp } from "./firebase-init.js";
import { logAudit } from "./audit.js";

const companiesCol = collection(db, "companies");

export async function getAllCompanies() {
  const snap = await getDocs(query(companiesCol, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenAllCompanies(callback) {
  return onSnapshot(query(companiesCol, orderBy("createdAt", "desc")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function blockCompany(companyId, blocked = true) {
  return updateDoc(doc(db, "companies", companyId), { status: blocked ? "blocked" : "active" });
}

export function deleteCompany(companyId) {
  // Napomena: briše samo dokument firme. Potpuno brisanje svih poddokumenata
  // (narudžbine, korisnici...) treba raditi preko Cloud Function batch brisanja.
  return deleteDoc(doc(db, "companies", companyId));
}

export function updateSubscription(companyId, { plan, validUntil, status }) {
  return updateDoc(doc(db, "companies", companyId), { subscription: { plan, validUntil, status } });
}

export async function updatePlatformSettings(settings) {
  await updateDoc(doc(db, "platform", "settings"), { ...settings, updatedAt: serverTimestamp() });
}

// Globalna statistika (Poglavlje 2.1) — jednostavno brojanje preko collectionGroup upita
export async function getGlobalStats() {
  const [companies, orders] = await Promise.all([
    getDocs(companiesCol),
    getDocs(collectionGroup(db, "orders")),
  ]);
  const activeCompanies = companies.docs.filter((d) => d.data().status !== "blocked").length;
  return {
    totalCompanies: companies.size,
    activeCompanies,
    blockedCompanies: companies.size - activeCompanies,
    totalOrders: orders.size,
  };
}
