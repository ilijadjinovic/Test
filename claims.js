// ============================================================================
// REKLAMACIJE — Poglavlje 2.3, 6: naručilac prijavljuje manjak/neusaglašenost
// ============================================================================
import { db, doc, collection, addDoc, updateDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp } from "./firebase-init.js";
import { ORDER_STATUS } from "./utils.js";
import { logAudit } from "./audit.js";
import { createNotification, NOTIF_EVENTS } from "./notifications.js";

const claimsCol = (companyId, orderId) => collection(db, "companies", companyId, "orders", orderId, "claims");

export async function openClaim(companyId, orderId, { itemName, requestedQty, receivedQty, description, actorUid, actorName, notifyUid }) {
  const ref = await addDoc(claimsCol(companyId, orderId), {
    itemName, requestedQty, receivedQty, description, status: "otvorena",
    createdByUid: actorUid, createdByName: actorName, createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.REKLAMACIJA, updatedAt: serverTimestamp() });
  await logAudit(companyId, { action: "claim_opened", entity: "Orders", entityId: orderId, actorUid, actorName, details: itemName });
  if (notifyUid) {
    await createNotification(companyId, { toUid: notifyUid, event: NOTIF_EVENTS.REKLAMACIJA_OTVORENA, orderId, titleKey: "notif_claim_opened_title", bodyParams: { name: actorName, item: itemName }, bodyKey: "notif_claim_opened_body" });
  }
  return ref.id;
}

export async function resolveClaim(companyId, orderId, claimId, { resolutionNote, actorName }) {
  await updateDoc(doc(db, "companies", companyId, "orders", orderId, "claims", claimId), {
    status: "zatvorena", resolutionNote, resolvedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "companies", companyId, "orders", orderId), { status: ORDER_STATUS.ZATVORENA, updatedAt: serverTimestamp(), closedAt: serverTimestamp() });
  await logAudit(companyId, { action: "claim_closed", entity: "Orders", entityId: orderId, actorName });
}

export async function getClaims(companyId, orderId) {
  const snap = await getDocs(query(claimsCol(companyId, orderId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function listenClaims(companyId, orderId, callback) {
  return onSnapshot(query(claimsCol(companyId, orderId), orderBy("createdAt", "desc")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
