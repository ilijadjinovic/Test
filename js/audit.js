// ============================================================================
// AUDIT LOG — Poglavlje 9.3: svaka izmena se evidentira trajno
// ============================================================================
import { db, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from "./firebase-init.js";

// action primeri: order_created, order_accepted, order_rejected, order_status_changed,
// item_purchased, claim_opened, claim_closed, user_created, supplier_created, ...
// Napomena: actorName ostaje null kad nije prosleđen — prikaz "sistemske" akcije
// se prevodi u trenutku prikaza (page-master-admin.js), ne u trenutku upisa,
// da bi poštovao jezik onoga ko GLEDA log, ne onoga ko je akciju izazvao.
export async function logAudit(companyId, { action, entity, entityId, actorUid = null, actorName = null, details = "" }) {
  try {
    await addDoc(collection(db, "companies", companyId, "auditLogs"), {
      action, entity, entityId, actorUid, actorName, details,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Audit log greška:", e);
  }
}

export async function getRecentAuditLogs(companyId, max = 50) {
  const q = query(collection(db, "companies", companyId, "auditLogs"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
