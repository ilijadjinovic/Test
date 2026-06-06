import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, query, orderBy, updateDoc, serverTimestamp, limit }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDPGWpEvyKuqbPdAU7Md5lhI8B4czhfFKE",
  authDomain: "akialexquiz.firebaseapp.com",
  projectId: "akialexquiz",
  storageBucket: "akialexquiz.firebasestorage.app",
  messagingSenderId: "794009330352",
  appId: "1:794009330352:web:e7dddbeb0b6cdce9a81175"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
         doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, query, orderBy,
         updateDoc, serverTimestamp, limit };
