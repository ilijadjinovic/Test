// ============================================================================
// PRILOZI — Poglavlje 11: Fiskalni računi, fotografije robe/isporuke
// ============================================================================
import { db, storage, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, ref, uploadBytes, getDownloadURL } from "./firebase-init.js";
import { uid } from "./utils.js";

// type: 'racun' | 'foto_robe' | 'foto_isporuke'
export async function uploadAttachment(companyId, orderId, file, { type, uploadedByUid, uploadedByName, receiptNumber = "" }) {
  const path = `companies/${companyId}/orders/${orderId}/${uid("att")}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await addDoc(collection(db, "companies", companyId, "orders", orderId, "attachments"), {
    type, fileName: file.name, url, path, receiptNumber,
    uploadedByUid, uploadedByName, createdAt: serverTimestamp(),
  });
  return url;
}

export function listenAttachments(companyId, orderId, callback) {
  const q = query(collection(db, "companies", companyId, "orders", orderId, "attachments"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
