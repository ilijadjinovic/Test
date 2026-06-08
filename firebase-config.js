
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth,GoogleAuthProvider,signInWithPopup,signOut } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const firebaseConfig={
 apiKey:'REPLACE',
 authDomain:'REPLACE',
 projectId:'REPLACE',
 storageBucket:'REPLACE',
 messagingSenderId:'REPLACE',
 appId:'REPLACE'
};

const app=initializeApp(firebaseConfig);

export const auth=getAuth(app);
export const db=getFirestore(app);

const provider=new GoogleAuthProvider();

export const login=()=>signInWithPopup(auth,provider);
export const logout=()=>signOut(auth);
