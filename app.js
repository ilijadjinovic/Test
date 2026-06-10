import { auth, db, login, logout, ADMIN_EMAIL } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';

document.getElementById('loginBtn').onclick  = login;
document.getElementById('logoutBtn').onclick = logout;

// ── Tab navigation ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    const tabId = b.dataset.tab;
    if (b.style.display === 'none') return;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    // kad se vrati na Stanovi tab, uvek pokaži listu
    if (tabId === 'units') showUnitList();
  };
});

function showTab(tabId) {
  document.querySelector(`.tab[data-tab="${tabId}"]`).style.display = '';
}
function hideTab(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  btn.style.display = 'none';
  const panel = document.getElementById(tabId);
  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('dashboard').classList.add('active');
    document.querySelector('.tab[data-tab="dashboard"]').classList.add('active');
  }
}

// ── Unit list / detail switching ────────────────────────────────
function showUnitList() {
  document.getElementById('unitsListView').hidden  = false;
  document.getElementById('unitDetailView').hidden = true;
}
function showUnitDetail() {
  document.getElementById('unitsListView').hidden  = true;
  document.getElementById('unitDetailView').hidden = false;
}

document.getElementById('backToUnits').onclick = showUnitList;

// ── Auth state ──────────────────────────────────────────────────
let unsubscribeMessages = null;

onAuthStateChanged(auth, user => {
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  updateProfileTab(user);

  if (!user) {
    hideTab('units');
    hideTab('finance');
    hideTab('messages');
    return;
  }

  showTab('messages');
  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (isAdmin) {
    showTab('units');
    showTab('finance');
    loadUnits();
    setupAdminMessages();
  } else {
    hideTab('units');
    hideTab('finance');
    setupTenantMessages(user);
  }
});

// ── Profile tab ─────────────────────────────────────────────────
function updateProfileTab(user) {
  const guest     = document.getElementById('profileGuest');
  const userDiv   = document.getElementById('profileUser');
  const topAvatar = document.getElementById('topbarAvatar');
  if (user) {
    guest.style.display   = 'none';
    userDiv.style.display = 'block';
    document.getElementById('profileName').textContent  = user.displayName || '—';
    document.getElementById('profileEmail').textContent = user.email || '—';
    const photo = user.photoURL;
    const photoEl = document.getElementById('profilePhoto');
    if (photo) { photoEl.src = photo; photoEl.style.display = ''; }
    else        { photoEl.style.display = 'none'; }
    topAvatar.style.display = 'flex';
    topAvatar.innerHTML = photo
      ? `<img src="${photo}" alt="avatar">`
      : `<span>${(user.displayName || user.email || '?').charAt(0).toUpperCase()}</span>`;
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-check';
  } else {
    guest.style.display     = 'block';
    userDiv.style.display   = 'none';
    topAvatar.style.display = 'none';
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-circle';
  }
}

// ── Units — lista ───────────────────────────────────────────────
async function loadUnits() {
  const ul = document.getElementById('unitList');
  ul.innerHTML = '';
  try {
    const snap = await getDocs(collection(db, 'units'));
    if (snap.empty) {
      ul.innerHTML = '<li style="color:var(--muted);font-size:14px">Nema unetih stanova.</li>';
      return;
    }
    snap.forEach(d => {
      const data = d.data();
      const li = document.createElement('li');
      li.className = 'unit-list-item';
      li.innerHTML = `
        <div class="unit-item-info">
          <span class="unit-item-name">${data.name}</span>
          <span class="unit-item-sub">${data.tenantEmail || 'bez zakupca'}</span>
        </div>
        <div class="unit-item-right">
          <span class="rent">${(data.rent || 0).toLocaleString('sr')} RSD</span>
          <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
      `;
      li.onclick = () => openUnitDetail(d.id, data);
      ul.appendChild(li);
    });
  } catch(e) {
    ul.innerHTML = '<li>Greška pri učitavanju — proveri Firestore Rules.</li>';
  }
}

document.getElementById('unitForm').onsubmit = async e => {
  e.preventDefault();
  await addDoc(collection(db, 'units'), {
    name:        document.getElementById('unitName').value.trim(),
    rent:        Number(document.getElementById('unitRent').value || 0),
    tenantEmail: document.getElementById('tenantEmail').value.trim().toLowerCase()
  });
  e.target.reset();
  await loadUnits();
  setupAdminMessages();
};

// ── Unit — detalji ──────────────────────────────────────────────
let currentUnitId = null;

async function openUnitDetail(unitId, baseData) {
  currentUnitId = unitId;
  document.getElementById('detailUnitName').textContent = baseData.name;
  showUnitDetail();

  // učitaj sačuvane detalje ako postoje
  try {
    const snap = await getDoc(doc(db, 'units', unitId));
    const d = snap.exists() ? snap.data() : {};
    document.getElementById('dAdresa').value     = d.adresa      || '';
    document.getElementById('dSprat').value      = d.sprat       ?? '';
    document.getElementById('dBrojStana').value   = d.brojStana   || '';
    document.getElementById('dKvad').value       = d.kvadratura  ?? '';
    document.getElementById('dStruktura').value  = d.struktura   || '';
    document.getElementById('dSpavace').value    = d.spavace     ?? '';
    document.getElementById('dKupatila').value   = d.kupatila    ?? '';
    document.getElementById('dTerasa').value     = d.terasa      || '';
    document.getElementById('dZakupacIme').value = d.zakupacIme  || '';
    document.getElementById('dZakupacDok').value = d.zakupacDok  || '';
    document.getElementById('dZakupOd').value    = d.zakupOd     || '';
    document.getElementById('dZakupDo').value    = d.zakupDo     || '';
    document.getElementById('dVrstaZakupa').value = d.vrstaZakupa || '';
    document.getElementById('dRenta').value       = d.rent        ?? '';
    document.getElementById('dValuta').value      = d.valuta      || '';
    document.getElementById('dIsplata').value     = d.isplata     || '';
  } catch(e) {
    console.error('Greška pri učitavanju detalja:', e);
  }
}

document.getElementById('saveUnitDetail').onclick = async () => {
  if (!currentUnitId) return;
  const btn = document.getElementById('saveUnitDetail');
  btn.disabled = true;
  btn.textContent = 'Čuvam...';
  try {
    await setDoc(doc(db, 'units', currentUnitId), {
      adresa:      document.getElementById('dAdresa').value.trim(),
      sprat:       Number(document.getElementById('dSprat').value)    || null,
      brojStana:   document.getElementById('dBrojStana').value.trim(),
      kvadratura:  Number(document.getElementById('dKvad').value)     || null,
      struktura:   document.getElementById('dStruktura').value,
      spavace:     Number(document.getElementById('dSpavace').value)  || null,
      kupatila:    Number(document.getElementById('dKupatila').value) || null,
      terasa:      document.getElementById('dTerasa').value,
      zakupacIme:  document.getElementById('dZakupacIme').value.trim(),
      zakupacDok:  document.getElementById('dZakupacDok').value.trim(),
      zakupOd:     document.getElementById('dZakupOd').value,
      zakupDo:     document.getElementById('dZakupDo').value,
      vrstaZakupa: document.getElementById('dVrstaZakupa').value,
      rent:        Number(document.getElementById('dRenta').value)    || 0,
      valuta:      document.getElementById('dValuta').value,
      isplata:     document.getElementById('dIsplata').value,
    }, { merge: true });
    btn.innerHTML = '<i class="ti ti-check"></i> Sačuvano';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-device-floppy"></i> Sačuvaj izmene';
    }, 2000);
    loadUnits(); // osvezi listu (renta se mogla promeniti)
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-device-floppy"></i> Sačuvaj izmene';
    alert('Greška pri čuvanju: ' + e.message);
  }
};

// ── Admin messages ──────────────────────────────────────────────
async function setupAdminMessages() {
  const container = document.getElementById('adminChats');
  document.getElementById('tenantChat').hidden = true;
  container.innerHTML = '<p class="info-text">Učitavam stanove...</p>';
  try {
    const snap = await getDocs(collection(db, 'units'));
    container.innerHTML = '';
    if (snap.empty) {
      container.innerHTML = '<p class="info-text">Nema stanova u bazi.</p>';
      return;
    }
    snap.forEach(docSnap => {
      const unit   = docSnap.data();
      const unitId = docSnap.id;
      const card   = document.createElement('div');
      card.className = 'chat-card';
      card.innerHTML = `
        <div class="chat-card-header">
          <i class="ti ti-home"></i>
          <span>${unit.name}</span>
          <small>${unit.tenantEmail || 'bez zakupca'}</small>
        </div>
        <div class="chat-messages" id="msgs-${unitId}"></div>
        <div class="chat-input-row">
          <input class="admin-msg-input" data-unit="${unitId}" placeholder="Odgovori..." autocomplete="off">
          <button class="btn-send admin-msg-send" data-unit="${unitId}">
            <i class="ti ti-send"></i>
          </button>
        </div>
      `;
      container.appendChild(card);
      const msgsRef = collection(db, 'units', unitId, 'messages');
      const q = query(msgsRef, orderBy('vreme', 'asc'));
      onSnapshot(q, snapshot => {
        const box = document.getElementById(`msgs-${unitId}`);
        if (!box) return;
        box.innerHTML = '';
        snapshot.forEach(m => renderMessage(box, m.data(), true));
        box.scrollTop = box.scrollHeight;
      });
    });
    container.addEventListener('click', async e => {
      const btn = e.target.closest('.admin-msg-send');
      if (!btn) return;
      const unitId = btn.dataset.unit;
      const input  = container.querySelector(`.admin-msg-input[data-unit="${unitId}"]`);
      const tekst  = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: ADMIN_EMAIL, tekst, vreme: serverTimestamp() });
    });
    container.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.admin-msg-input');
      if (!input) return;
      const unitId = input.dataset.unit;
      const tekst  = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: ADMIN_EMAIL, tekst, vreme: serverTimestamp() });
    });
  } catch(err) {
    container.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Tenant messages ─────────────────────────────────────────────
async function setupTenantMessages(user) {
  document.getElementById('adminChats').innerHTML = '';
  const tenantChat = document.getElementById('tenantChat');
  tenantChat.hidden = false;
  const header  = document.getElementById('tenantChatHeader');
  const msgsBox = document.getElementById('tenantMessages');
  const input   = document.getElementById('tenantMsgInput');
  const sendBtn = document.getElementById('tenantMsgSend');
  try {
    const q    = query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) {
      header.textContent = '';
      msgsBox.innerHTML  = '<p class="info-text">Nemate dodeljen stan.</p>';
      input.disabled = true; sendBtn.disabled = true;
      return;
    }
    const unitDoc = snap.docs[0];
    const unitId  = unitDoc.id;
    header.textContent = unitDoc.data().name;
    const mq = query(collection(db, 'units', unitId, 'messages'), orderBy('vreme', 'asc'));
    unsubscribeMessages = onSnapshot(mq, snapshot => {
      msgsBox.innerHTML = '';
      snapshot.forEach(m => renderMessage(msgsBox, m.data(), false, user.email));
      msgsBox.scrollTop = msgsBox.scrollHeight;
    });
    const send = async () => {
      const tekst = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: user.email, tekst, vreme: serverTimestamp() });
    };
    sendBtn.onclick = send;
    input.onkeydown = e => { if (e.key === 'Enter') send(); };
  } catch(err) {
    msgsBox.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Render poruke ───────────────────────────────────────────────
function renderMessage(container, data, isAdmin, currentUserEmail) {
  const div = document.createElement('div');
  const isMe = isAdmin ? data.od === ADMIN_EMAIL : data.od === currentUserEmail;
  div.className = 'chat-bubble ' + (isMe ? 'bubble-me' : 'bubble-them');
  div.textContent = data.tekst;
  container.appendChild(div);
}
