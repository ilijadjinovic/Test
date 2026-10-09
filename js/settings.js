// ============================================================================
// PODEŠAVANJA FIRME (Settings) — osnovni podaci, lokalizacija, dodela, GPS
// ============================================================================
import { db, doc, getDoc, updateDoc } from "./firebase-init.js";
import { logAudit } from "./audit.js";

export async function getCompanySettings(companyId) {
  const snap = await getDoc(doc(db, "companies", companyId));
  return snap.exists() ? snap.data() : null;
}

export async function updateCompanySettings(companyId, data, actorName) {
  await updateDoc(doc(db, "companies", companyId), data);
  await logAudit(companyId, { action: "settings_updated", entity: "Settings", entityId: companyId, actorName });
}
