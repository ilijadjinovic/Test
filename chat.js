// ============================================================================
// CHAT — poruke vezane za narudžbinu (naručilac ↔ isporučilac ↔ admin firme)
// ============================================================================
import { db, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "./firebase-init.js";
import { createNotification, NOTIF_EVENTS } from "./notifications.js";

export function sendMessage(companyId, orderId, { fromUid, fromName, text }) {
  return addDoc(collection(db, "companies", companyId, "orders", orderId, "messages"), {
    fromUid, fromName, text, createdAt: serverTimestamp(),
  });
}

export function listenMessages(companyId, orderId, callback) {
  const q = query(collection(db, "companies", companyId, "orders", orderId, "messages"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function sendMessageAndNotify(companyId, orderId, { fromUid, fromName, text, toUid }) {
  await sendMessage(companyId, orderId, { fromUid, fromName, text });
  if (toUid) {
    await createNotification(companyId, {
      toUid, event: NOTIF_EVENTS.NOVA_PORUKA, orderId,
      titleKey: "notif_new_message_title", bodyParams: { name: fromName },
      body: text.slice(0, 120),
    });
  }
}
