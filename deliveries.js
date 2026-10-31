// ============================================================================
// LOKACIJE ISPORUKE (DeliveryLocations) — Poglavlje 5.2
// Svaka lokacija u okviru narudžbine ima svoj status: Čeka → Isporučeno → Potvrđeno
// ============================================================================
import { db, doc, updateDoc, serverTimestamp } from "./firebase-init.js";
import { DELIVERY_LOCATION_STATUS } from "./utils.js";
import { logAudit } from "./audit.js";

export function markLocationDelivered(companyId, orderId, locId, actorName) {
  logAudit(companyId, { action: "delivery_location_delivered", entity: "DeliveryLocations", entityId: locId, actorName });
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "deliveryLocations", locId), {
    status: DELIVERY_LOCATION_STATUS.ISPORUCENO, deliveredAt: serverTimestamp(),
  });
}

export function confirmLocationReceipt(companyId, orderId, locId, actorName) {
  logAudit(companyId, { action: "delivery_location_confirmed", entity: "DeliveryLocations", entityId: locId, actorName });
  return updateDoc(doc(db, "companies", companyId, "orders", orderId, "deliveryLocations", locId), {
    status: DELIVERY_LOCATION_STATUS.POTVRDJENO, confirmedAt: serverTimestamp(),
  });
}

// GPS ETA prikaz (opciono) — Poglavlje 10.2. Placeholder: u produkciji povezati
// sa geolokacijom isporučioca (Geolocation API) i servisom za rutiranje.
export function estimateArrival(distanceKm, avgSpeedKmh = 30) {
  const minutes = Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
  return `${minutes} min do lokacije`;
}
