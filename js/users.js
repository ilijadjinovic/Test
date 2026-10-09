// ============================================================================
// KORISNICI FIRME — Poglavlje 2.2: Admin firme kreira naloge i uloge
//
// Napomena: kreiranje Firebase Auth naloga iz browsera bi odjavilo trenutnog
// Admina (SDK menja aktivnu sesiju). Da bismo to izbegli, koristimo DRUGU
// (sekundarnu) Firebase app instancu samo za createUser poziv — sesija
// Admina u glavnoj app instanci ostaje netaknuta.
// Za produkciju je čistije rešenje Cloud Function (Admin SDK) — vidi README.
// ============================================================================
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth as getAuthSecondary, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, collection, doc, setDoc, updateDoc, deleteDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp } from "./firebase-init.js";
import { firebaseConfig } from "./firebase-config.js";
import { logAudit } from "./audit.js";

const usersCol = (companyId) => collection(db, "companies", companyId, "usersIndex"); // lightweight index for listing

export async function createCompanyUser(companyId, { name, email, password, role, actorName }) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuthSecondary(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await updateProfile(cred.user, { displayName: name });

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid, companyId, name, email, role, active: true, createdAt: serverTimestamp(),
    });
    // index dokument u okviru firme radi lakšeg listanja/pretrage
    await setDoc(doc(db, "companies", companyId, "usersIndex", cred.user.uid), {
      uid: cred.user.uid, name, email, role, active: true, createdAt: serverTimestamp(),
    });

    await logAudit(companyId, { action: "user_created", entity: "Users", entityId: cred.user.uid, actorName, details: `${name} (${role})` });
    return cred.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export function updateCompanyUser(companyId, uidValue, data) {
  const p1 = updateDoc(doc(db, "users", uidValue), data);
  const p2 = updateDoc(doc(db, "companies", companyId, "usersIndex", uidValue), data);
  return Promise.all([p1, p2]);
}

export function deactivateUser(companyId, uidValue) {
  return updateCompanyUser(companyId, uidValue, { active: false });
}

export async function getCompanyUsers(companyId) {
  const snap = await getDocs(query(usersCol(companyId), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function listenCompanyUsers(companyId, callback) {
  return onSnapshot(query(usersCol(companyId), orderBy("name")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function getIsporucioci(companyId) {
  const users = await getCompanyUsers(companyId);
  return users.filter((u) => u.role === "isporucilac" && u.active !== false);
}

export async function getNarucioci(companyId) {
  const users = await getCompanyUsers(companyId);
  return users.filter((u) => u.role === "narucilac" && u.active !== false);
}
