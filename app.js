import { auth, db, login, logout, ADMIN_EMAIL } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { setupFinance, getDashboardTotals, showFinanceList } from './finance.js';

// ── Globalno stanje ──────────────────────────────────────────────
let currentUser     = null;
let userRoles       = { isAdmin: false, isLandlord: false, isTenant: false };
let activeContext   = 'izdavanje'; // 'izdavanje' | 'zakup'
let unsubscribeMessages = null;

// ── Login/Logout ─────────────────────────────────────────────────
document.getElementById('loginBtn').onclick  = login;
document.getElementById('logoutBtn').onclick = logout;

// ── Context switcher (IZDAVANJE / ZAKUP) ────────────────────────
document.getElementById('ctxIzdavanje').onclick = () => setContext('izdavanje');
document.getElementById('ctxZakup').onclick     = () => setContext('zakup');

function setContext(ctx) {
  activeContext = ctx;
  document.getElementById('ctxIzdavanje').classList.toggle('active', ctx === 'izdavanje');
  document.getElementById('ctxZakup').classList.toggle('active', ctx === 'zakup');
  applyTabVisibility();
  // Aktiviraj odgovarajući default tab
  if (ctx === 'zakup') {
    switchTab('messages');
  } else {
    switchTab('dashboard');
  }
}

// ── Tab navigacija ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    if (b.style.display === 'none') return;
    switchTab(b.dataset.tab);
  };
});

function switchTab(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!btn || btn.style.display === 'none') return;
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.add('active');
  if (tabId === 'units')   showUnitList();
  if (tabId === 'finance') showFinanceList();
}

function showTabBtn(tabId)  { const b = document.querySelector(`.tab[data-tab="${tabId}"]`); if (b) b.style.display = ''; }
function hideTabBtn(tabId)  {
  const b = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!b) return;
  b.style.display = 'none';
  if (b.classList.contains('active')) switchTab('profil');
}

// ── Primeni vidljivost tabova po ulozi i kontekstu ───────────────
function applyTabVisibility() {
  const { isAdmin, isLandlord, isTenant } = userRoles;
  const both = isLandlord && isTenant;

  // Context switcher — samo ako je i landlord i zakupac
  const showCtx = both;
  document.getElementById('contextSwitcher').style.display = showCtx ? 'flex' : 'none';
  document.body.classList.toggle('no-ctx', !showCtx);

  // Profil uvek vidljiv
  showTabBtn('profil');

  if (isAdmin) {
    showTabBtn('dashboard');
    showTabBtn('units');
    showTabBtn('messages');
    showTabBtn('finance');
    return;
  }

  if (both) {
    if (activeContext === 'izdavanje') {
      showTabBtn('dashboard');
      showTabBtn('units');
      showTabBtn('messages');
      showTabBtn('finance');
    } else {
      hideTabBtn('dashboard');
      showTabBtn('units');
      showTabBtn('messages');
      hideTabBtn('finance');
    }
    return;
  }

  if (isLandlord) {
    showTabBtn('dashboard');
    showTabBtn('units');
    showTabBtn('messages');
    showTabBtn('finance');
    return;
  }

  // Samo zakupac ili novi korisnik — uvek stanovi, poruke, profil
  hideTabBtn('dashboard');
  showTabBtn('units');
  showTabBtn('messages');
  hideTabBtn('finance');
}

// ── Auth state ───────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  currentUser = user;
  updateProfileTab(user);

  if (!user) {
    userRoles = { isAdmin: false, isLandlord: false, isTenant: false };
    document.getElementById('contextSwitcher').style.display = 'none';
    document.body.classList.add('no-ctx');
    hideTabBtn('dashboard');
    hideTabBtn('finance');
    showTabBtn('units');
    showTabBtn('messages');
    showTabBtn('profil');
    switchTab('profil');
    return;
  }

  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  if (isAdmin) {
    userRoles = { isAdmin: true, isLandlord: true, isTenant: false };
    applyTabVisibility();
    switchTab('dashboard');
    loadUnits();
    setupAdminMessages();
    setupFinance();
    loadDashboard();
    setupKvarView(user);
    return;
  }

  // Provjeri onboarding
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  if (!userDoc.exists()) {
    showOnboarding(user);
    return;
  }

  // Detekcija uloga
  await detectRoles(user);
});

// ── Detekcija uloga ──────────────────────────────────────────────
async function detectRoles(user) {
  let isLandlord = false;
  let isTenant   = false;

  try {
    // Landlord: ima stanove gdje je ownerId == uid
    const landlordQ = query(collection(db, 'units'), where('ownerId', '==', user.uid));
    const landlordSnap = await getDocs(landlordQ);
    isLandlord = !landlordSnap.empty;

    // Zakupac: email dodijeljen nekom stanu
    const tenantQ = query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase()));
    const tenantSnap = await getDocs(tenantQ);
    isTenant = !tenantSnap.empty;
  } catch(e) {
    console.error('detectRoles greška:', e);
  }

  userRoles = { isAdmin: false, isLandlord, isTenant };

  // Default context
  if (isLandlord) activeContext = 'izdavanje';
  else            activeContext = 'zakup';

  applyTabVisibility();
  // Refresh role badges now that roles are known
  updateProfileTab(user);

  // Pokreni odgovarajuće funkcije
  if (isLandlord) {
    setupFinance();
    loadDashboard();
    loadUnits();
    setupAdminMessages();
    setupKvarView(user);
    switchTab('dashboard');
  } else {
    // Samo zakupac (ili novi bez stanova)
    setupTenantMessages(user);
    setupKvarView(user);
    switchTab('messages');
  }

  if (isTenant && !isLandlord) {
    setupTenantMessages(user);
    setupKvarView(user);
  }
}

// ── Onboarding modal ─────────────────────────────────────────────
function showOnboarding(user) {
  document.getElementById('onboardingModal').classList.add('active');
  document.getElementById('onboardingName').value = user.displayName || '';
}

document.getElementById('onboardingSubmit').onclick = async () => {
  const name    = document.getElementById('onboardingName').value.trim();
  const company = document.getElementById('onboardingCompany').value.trim();
  if (!name) { alert('Unesi ime.'); return; }

  const btn = document.getElementById('onboardingSubmit');
  btn.disabled = true;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      name, company, email: currentUser.email,
      createdAt: serverTimestamp()
    });
    document.getElementById('onboardingModal').classList.remove('active');
    await detectRoles(currentUser);
  } catch(e) {
    alert('Greška: ' + e.message);
  }
  btn.disabled = false;
};

// ── Profile tab ──────────────────────────────────────────────────
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

    // Role badges
    let badgesHtml = '';
    if (userRoles.isAdmin)    badgesHtml += `<span class="role-badge admin"><i class="ti ti-crown"></i>Master Admin</span>`;
    if (userRoles.isLandlord) badgesHtml += `<span class="role-badge landlord"><i class="ti ti-home-2"></i>Landlord</span>`;
    if (userRoles.isTenant)   badgesHtml += `<span class="role-badge tenant"><i class="ti ti-key"></i>Zakupac</span>`;
    let badges = document.getElementById('profileRoleBadges');
    if (!badges) {
      badges = document.createElement('div');
      badges.id = 'profileRoleBadges';
      badges.className = 'role-badges';
      document.querySelector('.profile-info').appendChild(badges);
    }
    badges.innerHTML = badgesHtml;
  } else {
    guest.style.display     = 'block';
    userDiv.style.display   = 'none';
    topAvatar.style.display = 'none';
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-circle';
  }
}

// ── Unit list / detail switching ─────────────────────────────────
function showUnitList() {
  document.getElementById('unitsListView').hidden  = false;
  document.getElementById('unitDetailView').hidden = true;
}
function showUnitDetail() {
  document.getElementById('unitsListView').hidden  = true;
  document.getElementById('unitDetailView').hidden = false;
}
document.getElementById('backToUnits').onclick = showUnitList;

// ── Units — lista ────────────────────────────────────────────────
async function loadUnits() {
  const ul = document.getElementById('unitList');
  ul.innerHTML = '';
  if (!currentUser) return;

  const isAdmin = currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  try {
    let snap;
    if (isAdmin) {
      snap = await getDocs(collection(db, 'units'));
    } else {
      const q = query(collection(db, 'units'), where('ownerId', '==', currentUser.uid));
      snap = await getDocs(q);
    }

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
          <span class="rent">${(data.rent || 0).toLocaleString('sr')} ${data.valuta || 'RSD'}</span>
          <button class="btn-delete-unit" title="Obriši stan">
            <i class="ti ti-trash" aria-hidden="true"></i>
          </button>
          <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
      `;
      li.addEventListener('click', e => {
        if (e.target.closest('.btn-delete-unit')) return;
        openUnitDetail(d.id, data);
      });
      li.querySelector('.btn-delete-unit').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Obriši stan "${data.name}"? Ova akcija je nepovratna.`)) return;
        try {
          await deleteDoc(doc(db, 'units', d.id));
          await loadUnits();
          setupAdminMessages();
        } catch(err) {
          alert('Greška pri brisanju: ' + err.message);
        }
      });
      ul.appendChild(li);
    });
  } catch(e) {
    ul.innerHTML = '<li>Greška pri učitavanju — proveri Firestore Rules.</li>';
  }
}

// Zakupac vidi stanove u kojima je zakupac (read-only)
async function loadTenantUnits() {
  const ul = document.getElementById('unitList');
  ul.innerHTML = '';
  if (!currentUser) return;
  try {
    const q    = query(collection(db, 'units'), where('tenantEmail', '==', currentUser.email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) {
      ul.innerHTML = '<li style="color:var(--muted);font-size:14px">Niste dodeljeni nijednom stanu.</li>';
      return;
    }
    snap.forEach(d => {
      const data = d.data();
      const li = document.createElement('li');
      li.className = 'unit-list-item';
      li.innerHTML = `
        <div class="unit-item-info">
          <span class="unit-item-name">${data.name}</span>
          <span class="unit-item-sub">${data.adresa || '—'}</span>
        </div>
        <div class="unit-item-right">
          <span class="rent">${(data.rent || 0).toLocaleString('sr')} ${data.valuta || 'RSD'}</span>
          <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
      `;
      ul.appendChild(li);
    });
  } catch(e) {
    ul.innerHTML = '<li>Greška pri učitavanju.</li>';
  }
}

document.getElementById('unitForm').onsubmit = async e => {
  e.preventDefault();
  if (!currentUser) return;
  const name        = document.getElementById('unitName').value.trim();
  const tenantEmail = document.getElementById('tenantEmail').value.trim().toLowerCase();
  const rent        = Number(document.getElementById('unitRent').value || 0);

  try {
    await addDoc(collection(db, 'units'), {
      name, tenantEmail, rent,
      ownerId: currentUser.uid,
      ownerEmail: currentUser.email.toLowerCase()
    });
    e.target.reset();
    // Ako korisnik nije bio landlord, postaje sada
    if (!userRoles.isLandlord) {
      userRoles.isLandlord = true;
      activeContext = 'izdavanje';
      applyTabVisibility();
      setupFinance();
      loadDashboard();
      setupAdminMessages();
    }
    await loadUnits();
    setupAdminMessages();
  } catch(err) {
    alert('Greška: ' + err.message);
  }
};

// ── Unit detalji ─────────────────────────────────────────────────
let currentUnitId = null;

async function openUnitDetail(unitId, baseData) {
  currentUnitId = unitId;
  document.getElementById('detailUnitName').textContent = baseData.name;
  showUnitDetail();
  try {
    const snap = await getDoc(doc(db, 'units', unitId));
    const d = snap.exists() ? snap.data() : {};
    document.getElementById('dAdresa').value      = d.adresa      || '';
    document.getElementById('dSprat').value        = d.sprat       ?? '';
    document.getElementById('dBrojStana').value    = d.brojStana   || '';
    document.getElementById('dKvad').value         = d.kvadratura  ?? '';
    document.getElementById('dStruktura').value    = d.struktura   || '';
    document.getElementById('dSpavace').value      = d.spavace     ?? '';
    document.getElementById('dKupatila').value     = d.kupatila    ?? '';
    document.getElementById('dTerasa').value       = d.terasa      || '';
    document.getElementById('dZakupacIme').value   = d.zakupacIme  || '';
    document.getElementById('dZakupacDok').value   = d.zakupacDok  || '';
    document.getElementById('dTenantEmail').value  = d.tenantEmail || '';
    document.getElementById('dZakupOd').value      = d.zakupOd     || '';
    document.getElementById('dZakupDo').value      = d.zakupDo     || '';
    document.getElementById('dVrstaZakupa').value  = d.vrstaZakupa || '';
    document.getElementById('dRenta').value        = d.rent        ?? '';
    document.getElementById('dValuta').value       = d.valuta      || '';
    document.getElementById('dIsplata').value      = d.isplata     || '';
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
      tenantEmail: document.getElementById('dTenantEmail').value.trim().toLowerCase(),
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
    loadUnits();
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-device-floppy"></i> Sačuvaj izmene';
    alert('Greška pri čuvanju: ' + e.message);
  }
};

// ── Admin / Landlord messages ────────────────────────────────────
async function setupAdminMessages() {
  if (!currentUser) return;
  const container = document.getElementById('adminChats');
  document.getElementById('tenantChat').hidden = true;
  container.innerHTML = '<p class="info-text">Učitavam stanove...</p>';

  const isAdmin = currentUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  try {
    let snap;
    if (isAdmin) {
      snap = await getDocs(collection(db, 'units'));
    } else {
      const q = query(collection(db, 'units'), where('ownerId', '==', currentUser.uid));
      snap = await getDocs(q);
    }
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

    const sendMsg = async (unitId, input) => {
      const tekst = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), {
        od: currentUser.email, tekst, vreme: serverTimestamp()
      });
    };

    container.addEventListener('click', async e => {
      const btn = e.target.closest('.admin-msg-send');
      if (!btn) return;
      const input = container.querySelector(`.admin-msg-input[data-unit="${btn.dataset.unit}"]`);
      await sendMsg(btn.dataset.unit, input);
    });
    container.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.admin-msg-input');
      if (!input) return;
      await sendMsg(input.dataset.unit, input);
    });
  } catch(err) {
    container.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Tenant messages ──────────────────────────────────────────────
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
    // Prikaži chat za prvi stan (može se proširiti na multi-stan)
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
      await addDoc(collection(db, 'units', unitId, 'messages'), {
        od: user.email, tekst, vreme: serverTimestamp()
      });
    };
    sendBtn.onclick    = send;
    input.onkeydown    = e => { if (e.key === 'Enter') send(); };
  } catch(err) {
    msgsBox.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Render poruke ────────────────────────────────────────────────
function renderMessage(container, data, isLandlordView, currentUserEmail) {
  const div  = document.createElement('div');
  const isMe = isLandlordView
    ? (data.od !== undefined && data.od !== null &&
       (data.od === currentUser?.email || data.od === ADMIN_EMAIL))
      ? (data.od === currentUser?.email)
      : false
    : data.od === currentUserEmail;
  div.className = 'chat-bubble ' + (isMe ? 'bubble-me' : 'bubble-them');
  div.textContent = data.tekst;
  container.appendChild(div);
}

// ── Dashboard totali ─────────────────────────────────────────────
async function loadDashboard() {
  try {
    const { income, expense, profit, currency } = await getDashboardTotals();
    const cur = currency || 'RSD';
    document.getElementById('income').textContent  = income.toLocaleString('sr-Latn',  { maximumFractionDigits: 2 }) + ' ' + cur;
    document.getElementById('expense').textContent = expense.toLocaleString('sr-Latn', { maximumFractionDigits: 2 }) + ' ' + cur;
    document.getElementById('profit').textContent  = profit.toLocaleString('sr-Latn',  { maximumFractionDigits: 2 }) + ' ' + cur;
  } catch(e) { /* tišina */ }
}

window.addEventListener('finance:currencyChanged', () => loadDashboard());

// ── MSG SUB-TABOVI ───────────────────────────────────────────────
document.querySelectorAll('.msg-subtab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.msg-subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.msg-subtab-content').forEach(c => {
      c.classList.remove('active');
      c.hidden = true;
    });
    btn.classList.add('active');
    const target = document.getElementById('subtab-' + btn.dataset.subtab);
    target.classList.add('active');
    target.hidden = false;
    if (btn.dataset.subtab === 'kvar') {
      const user = auth.currentUser;
      if (!user) return;
      const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      if (isAdmin || userRoles.isLandlord) loadKvarAdmin();
      else loadKvarTenantHistory(user);
    }
  };
});

// ── KVAR — konstante ─────────────────────────────────────────────
const KVAR_STAVKE = {
  uredjaj: [
    'Mali bojler', 'Veliki bojler', 'Ploča za kuvanje', 'Rerna',
    'Mikrotalasna', 'Ketler', 'Osvetljenje', 'Mašina za veš',
    'Mašina za sudove', 'Slavina kuhinjska', 'Slavina umivaonik',
    'Slavina tuš', 'Klima uređaj', 'Frižider', 'TV', 'Interfon',
    'Bojler (akumulator)', 'Aspirator'
  ],
  struja: [
    'Prekid napajanja u kompletnom stanu', 'Delimični prekid napajanja',
    'Neispravan osigurač', 'Isklučio se automatski osigurač',
    'Strujni udar / varničenje', 'Neispravna utičnica ili prekidač',
    'Problem sa brojilom', 'Ostalo — struja'
  ],
  lom: [
    'Lom nameštaja', 'Lom stakla', 'Lom uređaja', 'Lom dela opreme',
    'Lom brave / kvake', 'Lom prozorskog okna', 'Lom sanitarije',
    'Lom pločice / keramike', 'Ostalo — lom'
  ],
  havarija: [
    'Pukla cev za vodu', 'Pukla cev za kanalizaciju',
    'Curi mali bojler', 'Curi veliki bojler',
    'Curi mašina za sudove', 'Curi mašina za veš',
    'Prodor vode iz drugog stana', 'Prodor vode sa krova',
    'Elementarna nepogoda', 'Poplava u stanu',
    'Pukao radijator / grejanje', 'Ostalo — havarija'
  ]
};
const KVAR_IKONE  = { uredjaj: 'ti-plug', struja: 'ti-bolt', lom: 'ti-hammer', havarija: 'ti-droplet' };
const KVAR_NAZIVI = { uredjaj: 'Kvar na uređaju', struja: 'Problem sa strujom', lom: 'Prijava loma', havarija: 'Havarija' };

let kvarTip     = 'uredjaj';
let kvarHitnost = 'srednja';

function updateKvarStavke() {
  const sel = document.getElementById('kvarStavka');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Izaberi stavku —</option>';
  (KVAR_STAVKE[kvarTip] || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
}

document.querySelectorAll('.kvar-type-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.kvar-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    kvarTip = btn.dataset.type;
    updateKvarStavke();
  };
});
document.querySelectorAll('.kvar-hitnost-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.kvar-hitnost-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    kvarHitnost = btn.dataset.h;
  };
});
updateKvarStavke();

// ── Submit kvar (zakupac) ────────────────────────────────────────
document.getElementById('kvarSubmitBtn').onclick = async () => {
  const stavka = document.getElementById('kvarStavka').value;
  const opis   = document.getElementById('kvarOpis').value.trim();
  if (!stavka) { alert('Izaberi stavku!'); return; }

  const btn = document.getElementById('kvarSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Šaljem...';
  try {
    const user = auth.currentUser;
    const q    = query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) { alert('Nemate dodeljen stan.'); btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Pošalji prijavu'; return; }
    const unitId   = snap.docs[0].id;
    const unitData = snap.docs[0].data();

    await addDoc(collection(db, 'kvarovi'), {
      unitId, unitName: unitData.name,
      ownerId: unitData.ownerId,
      tenantEmail: user.email.toLowerCase(),
      tip: kvarTip, stavka, opis,
      hitnost: kvarHitnost,
      status: 'otvoreno',
      vreme: serverTimestamp()
    });

    btn.innerHTML = '<i class="ti ti-check"></i> Poslato!';
    document.getElementById('kvarStavka').value = '';
    document.getElementById('kvarOpis').value   = '';
    loadKvarTenantHistory(user);
    setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Pošalji prijavu'; }, 2000);
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Pošalji prijavu';
    alert('Greška: ' + e.message);
  }
};

// ── Istorija kvarova — zakupac ───────────────────────────────────
async function loadKvarTenantHistory(user) {
  const container = document.getElementById('kvarTenantHistory');
  container.innerHTML = '<p class="info-text">Učitavam...</p>';
  try {
    const q    = query(collection(db, 'kvarovi'),
                       where('tenantEmail', '==', user.email.toLowerCase()),
                       orderBy('vreme', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) { container.innerHTML = '<p class="info-text">Nema prijava.</p>'; return; }
    container.innerHTML = '';
    snap.forEach(d => container.appendChild(renderKvarItem(d.id, d.data(), false)));
  } catch(e) {
    container.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Lista kvarova — landlord/admin ───────────────────────────────
async function loadKvarAdmin() {
  const list  = document.getElementById('kvarAdminList');
  const empty = document.getElementById('kvarAdminEmpty');
  list.innerHTML = '';
  empty.textContent = 'Učitavam prijave...';
  try {
    const user    = auth.currentUser;
    const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    let snap;
    if (isAdmin) {
      snap = await getDocs(query(collection(db, 'kvarovi'), orderBy('vreme', 'desc')));
    } else {
      snap = await getDocs(query(collection(db, 'kvarovi'),
        where('ownerId', '==', user.uid), orderBy('vreme', 'desc')));
    }
    if (snap.empty) { empty.textContent = 'Nema prijavljenih kvarova.'; return; }
    empty.textContent = '';
    snap.forEach(d => list.appendChild(renderKvarItem(d.id, d.data(), true)));
  } catch(e) {
    empty.textContent = 'Greška pri učitavanju.';
  }
}

// ── Render jedne prijave kvara ───────────────────────────────────
function renderKvarItem(id, data, isAdmin) {
  const div  = document.createElement('div');
  div.className = 'kvar-item';
  const vreme = data.vreme?.toDate
    ? data.vreme.toDate().toLocaleDateString('sr-Latn', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '—';
  const ikona = KVAR_IKONE[data.tip] || 'ti-tool';
  div.innerHTML = `
    <div class="kvar-item-top">
      <div class="kvar-item-icon ${data.tip}"><i class="ti ${ikona}"></i></div>
      <div class="kvar-item-title">${data.stavka}</div>
      <div class="kvar-item-date">${vreme}</div>
    </div>
    <div class="kvar-item-meta">
      <span class="kvar-badge h-${data.hitnost}">${data.hitnost.charAt(0).toUpperCase()+data.hitnost.slice(1)} hitnost</span>
      <span class="kvar-badge">${KVAR_NAZIVI[data.tip] || data.tip}</span>
      ${isAdmin ? `<span class="kvar-item-unit">${data.unitName || data.unitId}</span>` : ''}
      <span class="kvar-badge status ${data.status === 'reseno' ? 'reseno' : ''}">${data.status === 'reseno' ? '✓ Rešeno' : '⏳ Otvoreno'}</span>
      ${isAdmin ? `<button class="kvar-status-toggle" data-id="${id}" data-status="${data.status}">${data.status === 'reseno' ? 'Ponovo otvori' : 'Označi rešeno'}</button>` : ''}
    </div>
    ${data.opis ? `<div class="kvar-item-opis">${data.opis}</div>` : ''}
  `;
  if (isAdmin) {
    div.querySelector('.kvar-status-toggle').onclick = async e => {
      const btn2     = e.currentTarget;
      const noviStatus = btn2.dataset.status === 'reseno' ? 'otvoreno' : 'reseno';
      btn2.disabled  = true;
      try {
        await setDoc(doc(db, 'kvarovi', id), { status: noviStatus }, { merge: true });
        loadKvarAdmin();
      } catch(err) {
        alert('Greška: ' + err.message);
        btn2.disabled = false;
      }
    };
  }
  return div;
}

// ── Kvar view setup ──────────────────────────────────────────────
function setupKvarView(user) {
  const isAdminOrLandlord = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || userRoles.isLandlord;
  // U ZAKUP kontekstu zakupac vidi tenant view čak i ako je landlord
  const showTenantView = userRoles.isTenant && (!userRoles.isLandlord || activeContext === 'zakup');
  const showAdminView  = isAdminOrLandlord && activeContext !== 'zakup';

  document.getElementById('kvarAdminView').hidden  = !showAdminView;
  document.getElementById('kvarTenantView').hidden = !showTenantView;

  // Ako je oboje, prikaži oba
  if (userRoles.isLandlord && userRoles.isTenant) {
    if (activeContext === 'izdavanje') {
      document.getElementById('kvarAdminView').hidden  = false;
      document.getElementById('kvarTenantView').hidden = true;
    } else {
      document.getElementById('kvarAdminView').hidden  = true;
      document.getElementById('kvarTenantView').hidden = false;
    }
  }
}
