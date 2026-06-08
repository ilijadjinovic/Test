
import { auth, db, login, logout } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { collection, addDoc, getDocs } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const loginBtn=document.getElementById('loginBtn');
const logoutBtn=document.getElementById('logoutBtn');

loginBtn.onclick=login;
logoutBtn.onclick=logout;

document.querySelectorAll('.tab').forEach(b=>{
 b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
 };
});

import { auth, db, login, logout, ADMIN_EMAIL } from './firebase-config.js';

onAuthStateChanged(auth,user=>{

 loginBtn.hidden=!!user;
 logoutBtn.hidden=!user;

 if(!user) return;

 const isAdmin =
     user.email.toLowerCase() ===
     ADMIN_EMAIL.toLowerCase();

 if(isAdmin){

     loadUnits();

     document.getElementById("units").style.display="block";
     document.getElementById("finance").style.display="block";

 }else{

     document.getElementById("units").style.display="none";
     document.getElementById("finance").style.display="none";

     loadTenantData(user);

 }

});

async function loadUnits(){
 const ul=document.getElementById('unitList');
 ul.innerHTML='';
 const snap=await getDocs(collection(db,'units'));
 snap.forEach(d=>{
   const li=document.createElement('li');
   li.textContent=d.data().name+' | renta '+(d.data().rent||0);
   ul.appendChild(li);
 });
}

document.getElementById('unitForm').onsubmit=async e=>{
 e.preventDefault();
 await addDoc(collection(db,'units'),{
   name:unitName.value,
   rent:Number(unitRent.value||0)
 });
 e.target.reset();
 loadUnits();
};
