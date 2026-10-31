// ============================================================================
// DOBAVLJAČI (Suppliers + SupLocations) — Poglavlje 8.2
// ============================================================================
import { db, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp } from "./firebase-init.js";
import { logAudit } from "./audit.js";

const suppliersCol = (companyId) => collection(db, "companies", companyId, "suppliers");
const supLocationsCol = (companyId, supplierId) => collection(db, "companies", companyId, "suppliers", supplierId, "locations");

export async function addSupplier(companyId, {
  name, contact = "", phone = "", email = "",
  pib = "", maticniBroj = "", address = "", bankAccount = "",
  workingHours = "", note = "",
  actorName, createdBy,
}) {
  const ref = await addDoc(suppliersCol(companyId), {
    name, contact, phone, email, pib, maticniBroj, address, bankAccount,
    workingHours, note,
    active: true, createdAt: serverTimestamp(), createdBy: createdBy || null,
  });
  await logAudit(companyId, { action: "supplier_created", entity: "Suppliers", entityId: ref.id, actorName, details: name });
  return ref.id;
}

export async function updateSupplier(companyId, id, data, actorName) {
  await updateDoc(doc(db, "companies", companyId, "suppliers", id), data);
  if (actorName) {
    await logAudit(companyId, { action: "supplier_updated", entity: "Suppliers", entityId: id, actorName, details: data.name || "" });
  }
}
export function deleteSupplier(companyId, id) {
  return deleteDoc(doc(db, "companies", companyId, "suppliers", id));
}
export async function getSuppliers(companyId) {
  const snap = await getDocs(query(suppliersCol(companyId), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenSuppliers(companyId, callback) {
  return onSnapshot(query(suppliersCol(companyId), orderBy("name")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// --- Lokacije preuzimanja robe za dobavljača (SupLocations) — narucilac sme da doda, briše samo admin (vidi firestore.rules) ---
// geo: { lat, lng, geoSource, geoQuality, geoUpdatedAt } — vidi geo-ui.js
export async function addSupplierLocation(companyId, supplierId, { name, address = "", createdBy, geo = {} }) {
  const ref = await addDoc(supLocationsCol(companyId, supplierId), { name, address, ...geo, createdAt: serverTimestamp(), createdBy: createdBy || null });
  return ref.id;
}
// Izmena lokacije preuzimanja — pravila baze: sve izmene samo admin; geo polja smeju i naručilac/isporučilac
export function updateSupplierLocation(companyId, supplierId, locId, data) {
  return updateDoc(doc(db, "companies", companyId, "suppliers", supplierId, "locations", locId), data);
}
export function deleteSupplierLocation(companyId, supplierId, locId) {
  return deleteDoc(doc(db, "companies", companyId, "suppliers", supplierId, "locations", locId));
}
export async function getSupplierLocations(companyId, supplierId) {
  const snap = await getDocs(query(supLocationsCol(companyId, supplierId), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Dobavljač kao odredište isporuke (povrat robe) ---------------------------------------
// Vraća opcije { locationId, locationName, kind:"supplier", supplierId, supplierLocationId }.
// Dobavljač sa lokacijama preuzimanja daje po jednu opciju za svaku lokaciju ("Naziv – Lokacija"),
// dobavljač bez lokacija jednu opciju (po adresi dobavljača).
export function buildSupplierDestinations(suppliers, locsBySupplier = {}) {
  const out = [];
  for (const s of suppliers) {
    const locs = locsBySupplier[s.id] || [];
    if (!locs.length) {
      out.push({ locationId: `sup:${s.id}`, locationName: s.name, kind: "supplier", supplierId: s.id, supplierLocationId: "" });
    } else {
      for (const l of locs) {
        out.push({ locationId: `sup:${s.id}:${l.id}`, locationName: `${s.name} – ${l.name}`, kind: "supplier", supplierId: s.id, supplierLocationId: l.id });
      }
    }
  }
  return out;
}
export async function getSupplierDestinations(companyId, suppliers) {
  const locsBySupplier = {};
  await Promise.all(suppliers.map(async (s) => {
    try { locsBySupplier[s.id] = await getSupplierLocations(companyId, s.id); } catch (e) { console.error(e); locsBySupplier[s.id] = []; }
  }));
  return buildSupplierDestinations(suppliers, locsBySupplier);
}
