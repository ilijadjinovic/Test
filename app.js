import { auth, db, login, logout, ADMIN_EMAIL } from './firebase-config.js';
import { onAuthStateChanged, getRedirectResult } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const loginBtn  = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

loginBtn.onclick  = login;
logoutBtn.onclick = logout;

// Hvatamo rezultat nakon Google redirect prijave
getRedirectResult(auth).catch(err => console.error('Redirect greška:', err));

// Tab navigacija
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(b.dataset.tab).classList.add('active');
  };
});

onAuthStateChanged(auth, user => {
  updateProfileTab(user);

  if (!user) return;

  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  if (isAdmin) {
    document.getElementById('units').style.display   = 'block';
    document.getElementById('finance').style.display = 'block';
    loadUnits();
  } else {
    document.getElementById('units').style.display   = 'none';
    document.getElementById('finance').style.display = 'none';
    loadTenantData(user);
  }
});

function updateProfileTab(user) {
  const guest     = document.getElementById('profileGuest');
  const userDiv   = document.getElementById('profileUser');
  const topAvatar = document.getElementById('topbarAvatar');

  if (user) {
    // Prikaži korisnički blok
    guest.hidden   = true;
    userDiv.hidden = false;

    document.getElementById('profileName').textContent  = user.displayName || '—';
    document.getElementById('profileEmail').textContent = user.email || '—';

    const photo = user.photoURL;
    if (photo) {
      document.getElementById('profilePhoto').src = photo;
    } else {
      // Fallback: inicijali
      const img = document.getElementById('profilePhoto');
      img.style.display = 'none';
    }

    // Mali avatar u topbaru
    topAvatar.hidden = false;
    if (photo) {
      topAvatar.innerHTML = `<img src="${photo}" alt="avatar">`;
    } else {
      const initials = (user.displayName || user.email || '?').charAt(0).toUpperCase();
      topAvatar.innerHTML = `<span>${initials}</span>`;
    }

    // Označi Profil tab ikonom (badge)
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-check';
  } else {
    guest.hidden   = false;
    userDiv.hidden = true;
    topAvatar.hidden = true;
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-circle';
  }
}

async function loadUnits() {
  const ul   = document.getElementById('unitList');
  ul.innerHTML = '';
  const snap = await getDocs(collection(db, 'units'));
  snap.forEach(d => {
    const li       = document.createElement('li');
    li.textContent = d.data().name + ' | renta ' + (d.data().rent || 0);
    ul.appendChild(li);
  });
}

document.getElementById('unitForm').onsubmit = async e => {
  e.preventDefault();
  await addDoc(collection(db, 'units'), {
    name:        document.getElementById('unitName').value,
    rent:        Number(document.getElementById('unitRent').value || 0),
    tenantEmail: document.getElementById('tenantEmail').value.trim().toLowerCase()
  });
  e.target.reset();
  loadUnits();
};

async function loadTenantData(user) {
  const q    = query(
    collection(db, 'units'),
    where('tenantEmail', '==', user.email.toLowerCase())
  );
  const snap = await getDocs(q);
  const box  = document.getElementById('messageBox');
  box.innerHTML = '';

  snap.forEach(doc => {
    const d = doc.data();
    box.innerHTML += `
      <div>
        <h3>${d.name}</h3>
        <p>Renta: ${d.rent}</p>
      </div>
    `;
  });

  if (snap.empty) {
    box.innerHTML = '<p>Nema dodeljenog stana za ovaj nalog.</p>';
  }
}
