// ============================================================================
// NOTIFIKACIJE — Poglavlje 10.1
// In-app notifikacije preko Firestore (realtime). Push notifikacije (PWA) su
// pripremljene kao kuka (requestPushPermission) — za produkciju je potrebno
// registrovati service-worker.js sa Firebase Cloud Messaging.
// ============================================================================
import { db, collection, addDoc, query, where, orderBy, limit, onSnapshot, updateDoc, doc, serverTimestamp } from "./firebase-init.js";

export const NOTIF_EVENTS = {
  NOVA_NARUDZBINA: "nova_narudzbina",
  NARUDZBINA_PRIHVACENA: "narudzbina_prihvacena",
  NARUDZBINA_ODBIJENA: "narudzbina_odbijena",
  KRENUO_U_NABAVKU: "krenuo_u_nabavku",
  ROBA_ISPORUCENA: "roba_isporucena",
  PRIJEM_POTVRDJEN: "prijem_potvrdjen",
  REKLAMACIJA_OTVORENA: "reklamacija_otvorena",
  NOVA_PORUKA: "nova_poruka",
};

// titleKey/bodyKey su i18n ključevi (Poglavlje 13.) — tekst se prevodi u trenutku
// prikaza (nav.js), prema jeziku koji je trenutno aktivan kod primaoca, a ne prema
// jeziku onoga ko je izazvao notifikaciju. bodyParams se ubacuju u {placeholder}-e.
export async function createNotification(companyId, { toUid, event, titleKey, bodyKey = null, bodyParams = null, body = null, orderId = null }) {
  await addDoc(collection(db, "companies", companyId, "notifications"), {
    toUid, event, titleKey, bodyKey, bodyParams, body, orderId, read: false, createdAt: serverTimestamp(),
  });
}

export function listenNotifications(companyId, uidValue, callback, max = 30) {
  const q = query(
    collection(db, "companies", companyId, "notifications"),
    where("toUid", "==", uidValue), orderBy("createdAt", "desc"), limit(max)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function markAsRead(companyId, notifId) {
  return updateDoc(doc(db, "companies", companyId, "notifications", notifId), { read: true });
}

// Za PWA push (opciono, zahteva firebase-messaging-sw.js i VAPID ključ)
export async function requestPushPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}
