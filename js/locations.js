// ============================================================================
// LOKACIJE FIRME (ComLocations) — magacini, prodavnice, kancelarije...
// ============================================================================
import { db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp } from "./firebase-init.js";
import { logAudit } from "./audit.js";

const col = (companyId) => collection(db, "companies", companyId, "locations");

export async function addLocation(companyId, { name, address, actorName }) {
  const ref = await addDoc(col(companyId), { name, address, active: true, createdAt: serverTimestamp() });
  await logAudit(companyId, { action: "location_created", entity: "ComLocations", entityId: ref.id, actorName });
  return ref.id;
}

export function updateLocation(companyId, id, data) {
  return updateDoc(doc(db, "companies", companyId, "locations", id), data);
}

export function deleteLocation(companyId, id) {
  return deleteDoc(doc(db, "companies", companyId, "locations", id));
}

export async function getLocations(companyId) {
  const snap = await getDocs(query(col(companyId), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenLocations(companyId, callback) {
  return onSnapshot(query(col(companyId), orderBy("name")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
