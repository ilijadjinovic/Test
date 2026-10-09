// ============================================================================
// FIREBASE CONFIG — popuni ovo svojim podacima iz Firebase Console
// (Project settings → General → Your apps → SDK setup and configuration)
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyDwMRzHVkS_7U_vBIQu7ImCLzU2VQqlnhw",
  authDomain: "orderandsupply.firebaseapp.com",
  projectId: "orderandsupply",
  storageBucket: "orderandsupply.firebasestorage.app",
  messagingSenderId: "967563507485",
  appId: "1:967563507485:web:210d8e5dd202259c4cd3f4"
};

// Napomena:
// 1) U Firebase Console uključi Authentication → Email/Password
// 2) Napravi Firestore bazu (Native mode)
// 3) Uključi Storage (za priloge/fotografije/račune)
// 4) Postavi pravila iz firestore.rules i storage.rules (Firestore/Storage → Rules)
// 5) Ovaj sistem je čist HTML/CSS/JS bez build alata — radi direktno u browseru
//    preko ES modula i CDN importa Firebase SDK-a (vidi firebase-init.js)
