import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCHdohv0tfLf8taODtLfMKQDPROJN_lwug",
  authDomain:        "rental-manager-da0fa.firebaseapp.com",
  projectId:         "rental-manager-da0fa",
  storageBucket:     "rental-manager-da0fa.firebasestorage.app",
  messagingSenderId: "470999148120",
  appId:             "1:470999148120:web:2fde820f24ca194f2c4c2d"
};

const app      = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

const provider = new GoogleAuthProvider();

export const login  = () => signInWithRedirect(auth, provider);
export const logout = () => signOut(auth);
export const ADMIN_EMAIL = "ilija.djinovic@gmail.com";
