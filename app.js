import { auth, db, login, logout, ADMIN_EMAIL } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { setupFinance, getDashboardTotals, showFinanceList } from './finance.js';

document.getElementById('loginBtn').onclick  = login;
document.getElementById('logoutBtn').onclick = logout;

// ── Sakrij sve tabove osim profil na startu ──────────────────────
['dashboard', 'units', 'messages', 'finance'].forEach(id => hideTabOnly(id));
document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
document.getElementById('profil').classList.add('active');
document.querySelector('.tab[data-tab="profil"]').classList.add('active');

// ── Tab navigation ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    const tabId = b.dataset.tab;
    if (b.style.display === 'none') return;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    if (tabId === 'units') showUnitList();
    if (tabId === 'finance') showFinanceList();
  };
});

// Samo sakrij tab dugme (bez redirect logike) — koristi se na init
function hideTabOnly(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (btn) btn.style.display = 'none';
}

function showTab(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (btn) btn.style.display = '';
}
function hideTab(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!btn) return;
  btn.style.display = 'none';
  const panel = document.getElementById(tabId);
  if (panel && panel.classList.contains('active')) {
    panel.classList.remove('active');
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('profil').classList.add('active');
    document.querySelector('.tab[data-tab="profil"]').classList.add('active');
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
let currentUserRole = null; // 'masterAdmin' | 'landlord' | 'tenant' | 'both' | 'new'
let currentUserObj  = null;
let currentContext  = 'landlord'; // 'landlord' | 'tenant' (za 'both' ulogu)

onAuthStateChanged(auth, async user => {
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }

  const activeTabBtn = document.querySelector('.tab.active');
  const currentTab   = activeTabBtn ? activeTabBtn.dataset.tab : null;

  if (!user) {
    currentUserObj  = null;
    currentUserRole = null;
    updateProfileTab(user, false, false, false);
    ['dashboard', 'units', 'messages', 'finance'].forEach(id => hideTab(id));
    document.getElementById('contextSwitcher').style.display = 'none';
    return;
  }

  currentUserObj = user;
  const isMasterAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Sačuvaj profil u Firestore da ga drugi mogu videti
  saveUserProfile(user).catch(() => {});

  let isLandlord = false;
  let isTenant   = false;

  if (!isMasterAdmin) {
    try {
      const [landlordSnap, tenantSnap] = await Promise.all([
        getDocs(query(collection(db, 'units'), where('ownerId', '==', user.uid))),
        getDocs(query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase())))
      ]);
      isLandlord = !landlordSnap.empty;
      isTenant   = !tenantSnap.empty;
      console.log('[Auth] isLandlord:', isLandlord, 'isTenant:', isTenant, 'uid:', user.uid, 'email:', user.email);
    } catch(e) {
      console.error('[Auth] Greška pri detekciji uloge:', e);
    }
  }

  updateProfileTab(user, isMasterAdmin, isLandlord, isTenant);

  if (isMasterAdmin)            currentUserRole = 'masterAdmin';
  else if (isLandlord && isTenant) currentUserRole = 'both';
  else if (isLandlord)          currentUserRole = 'landlord';
  else if (isTenant)            currentUserRole = 'tenant';
  else                          currentUserRole = 'new';

  // Prikaži/sakrij context switcher
  const switcher = document.getElementById('contextSwitcher');
  if (currentUserRole === 'both') {
    switcher.style.display = 'flex';
    document.querySelectorAll('.ctx-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.ctx === currentContext);
    });
  } else {
    switcher.style.display = 'none';
    currentContext = (currentUserRole === 'tenant') ? 'tenant' : 'landlord';
  }

  applyContext(user, currentTab);
});

// ── Primeni kontekst ─────────────────────────────────────────────
function applyContext(user, preferredTab) {
  const role = currentUserRole;
  const isLandlordCtx = role === 'masterAdmin' || role === 'landlord' || (role === 'both' && currentContext === 'landlord');

  // Osvježi badge svaki put (uloga se mogla promeniti)
  const isMasterAdmin = role === 'masterAdmin';
  const isLandlord    = role === 'landlord' || role === 'both';
  const isTenant      = role === 'tenant'   || role === 'both';
  updateProfileTab(user, isMasterAdmin, isLandlord, isTenant);

  if (role === 'masterAdmin') {
    currentOwnerUid = null;
    showTab('dashboard'); showTab('units'); showTab('messages'); showTab('finance');
    activateTab(preferredTab || 'dashboard');
    loadUnits(); setupAdminMessages(); setupFinance(); loadDashboard();
    setupKvarView(user, 'masterAdmin');

  } else if (isLandlordCtx) {
    currentOwnerUid = user.uid;
    showTab('dashboard'); showTab('units'); showTab('messages'); showTab('finance');
    const safe = ['dashboard','units','messages','finance','profil'];
    activateTab((preferredTab && safe.includes(preferredTab)) ? preferredTab : 'units');
    loadUnitsLandlord(user); setupLandlordMessages(user); setupFinance();
    loadDashboard(user.uid); setupKvarView(user, 'landlord');

  } else {
    // tenant ili new ili both u zakup kontekstu
    currentOwnerUid = null;
    hideTab('dashboard'); showTab('units'); showTab('messages'); hideTab('finance');
    const safe = ['units','messages','profil'];
    activateTab((preferredTab && safe.includes(preferredTab)) ? preferredTab : (role === 'new' ? 'units' : 'messages'));
    setupTenantMessages(user); setupKvarView(user, role === 'new' ? 'new' : 'tenant');
    loadUnitsTenant(user);
  }
}

// ── Context switcher klikovi ─────────────────────────────────────
document.querySelectorAll('.ctx-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentUserObj || currentUserRole !== 'both') return;
    const newCtx = btn.dataset.ctx;
    if (newCtx === currentContext) return;
    currentContext = newCtx;
    document.querySelectorAll('.ctx-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.ctx === currentContext);
    });
    const activeTabBtn = document.querySelector('.tab.active');
    applyContext(currentUserObj, activeTabBtn ? activeTabBtn.dataset.tab : null);
  });
});

// Aktiviraj tab bez redirect logike
function activateTab(tabId) {
  const btn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  const safe = (btn && btn.style.display !== 'none') ? tabId : 'profil';
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.getElementById(safe).classList.add('active');
  const safeBtn = document.querySelector(`.tab[data-tab="${safe}"]`);
  if (safeBtn) safeBtn.classList.add('active');
}
// ── Profile tab ─────────────────────────────────────────────────
function updateProfileTab(user, isMasterAdmin, isLandlord, isTenant) {
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

    // Bedževi uloga
    const badgeWrap = document.getElementById('profileBadges');
    if (badgeWrap) {
      badgeWrap.innerHTML = '';
      if (isMasterAdmin) {
        badgeWrap.innerHTML += `<span class="profile-badge badge-master">Master Admin</span>`;
      } else {
        if (isLandlord) badgeWrap.innerHTML += `<span class="profile-badge badge-landlord">Landlord</span>`;
        if (isTenant)   badgeWrap.innerHTML += `<span class="profile-badge badge-tenant">Zakupac</span>`;
        if (!isLandlord && !isTenant) badgeWrap.innerHTML += `<span class="profile-badge">Aktivan nalog</span>`;
      }
    }
  } else {
    guest.style.display     = 'block';
    userDiv.style.display   = 'none';
    topAvatar.style.display = 'none';
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-circle';
  }
}

// ── Unit list item builder ──────────────────────────────────────
function buildUnitLi(unitId, data, canDelete) {
  const li = document.createElement('li');
  li.className = 'unit-list-item';
  li.innerHTML = `
    <div class="unit-item-info">
      <span class="unit-item-name">${data.name}</span>
      <span class="unit-item-sub"><span class="unit-label">Zakupac:</span> ${data.tenantEmail || 'bez zakupca'}</span>
    </div>
    <div class="unit-item-right">
      <span class="rent">${(data.rent || 0).toLocaleString('sr')} ${data.valuta || 'RSD'}</span>
      ${canDelete ? `<button class="btn-delete-unit" title="Obriši stan"><i class="ti ti-trash" aria-hidden="true"></i></button>` : ''}
      <i class="ti ti-chevron-right" aria-hidden="true"></i>
    </div>
  `;
  li.addEventListener('click', e => {
    if (e.target.closest('.btn-delete-unit')) return;
    openUnitDetail(unitId, data);
  });
  if (canDelete) {
    li.querySelector('.btn-delete-unit').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Obriši stan "${data.name}"? Biće obrisane i sve poruke, finansije i prijave kvara.`)) return;
      try {
        await deleteUnitCascade(unitId);
        const isMasterAdmin = auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        if (isMasterAdmin) { await loadUnits(); setupAdminMessages(); }
        else { await loadUnitsLandlord(auth.currentUser); setupLandlordMessages(auth.currentUser); }
      } catch(err) { alert('Greška: ' + err.message); }
    });
  }
  return li;
}

// ── Units — lista (zakupac / novi korisnik) ──────────────────────
async function loadUnitsTenant(user) {
  const ul = document.getElementById('unitList');
  ul.innerHTML = '';
  // Forma za dodavanje stana uvek vidljiva
  const form = document.getElementById('unitForm');
  if (form) form.style.display = '';
  try {
    const snap = await getDocs(query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase())));
    if (snap.empty) {
      ul.innerHTML = '<li style="color:var(--muted);font-size:14px;padding:8px 0">Nemate dodeljenih stanova.</li>';
      return;
    }
    snap.forEach(async d => {
      const data = d.data();
      // Učitaj profil vlasnika
      let ownerLabel = '—';
      if (data.ownerId) {
        try {
          const ownerSnap = await getDoc(doc(db, 'users', data.ownerId));
          if (ownerSnap.exists()) {
            const op = ownerSnap.data();
            ownerLabel = op.displayName ? `${op.displayName} (${op.email})` : (op.email || data.ownerEmail || '—');
          } else {
            ownerLabel = data.ownerEmail || '—';
          }
        } catch(e) {
          ownerLabel = data.ownerEmail || '—';
        }
      } else if (data.ownerEmail) {
        ownerLabel = data.ownerEmail;
      }
      const li = document.createElement('li');
      li.className = 'unit-list-item';
      li.innerHTML = `
        <div class="unit-item-info">
          <span class="unit-item-name">${data.name}</span>
          <span class="unit-item-sub"><span class="unit-label">Vlasnik:</span> ${ownerLabel}</span>
        </div>
        <div class="unit-item-right">
          <span class="rent">${(data.rent || 0).toLocaleString('sr')} ${data.valuta || 'RSD'}</span>
          <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </div>
      `;
      li.addEventListener('click', () => openUnitDetail(d.id, data));
      ul.appendChild(li);
    });
  } catch(e) {
    ul.innerHTML = '<li style="color:var(--muted);font-size:14px">Greška pri učitavanju.</li>';
  }
}

// ── Units — lista (landlord) ─────────────────────────────────
async function loadUnitsLandlord(user) {
  const ul   = document.getElementById('unitList');
  const form = document.getElementById('unitForm');
  ul.innerHTML = '';
  if (form) form.style.display = '';
  try {
    const snap = await getDocs(query(collection(db, 'units'), where('ownerId', '==', user.uid)));
    const profile = (await getDoc(doc(db, 'users', user.uid))).data() || {};
    const name  = profile.displayName || user.displayName || '—';
    const email = profile.email || user.email;
    ul.appendChild(renderOwnerSection(name, email));
    if (snap.empty) {
      const li = document.createElement('li');
      li.style.cssText = 'color:var(--muted);font-size:14px;padding:8px 0';
      li.textContent = 'Nemate unetih stanova.';
      ul.appendChild(li);
      return;
    }
    snap.forEach(d => ul.appendChild(buildUnitLi(d.id, d.data(), true)));
  } catch(e) {
    ul.innerHTML = '<li>Greška pri učitavanju — proveri Firestore Rules.</li>';
  }
}


// ── Landlord messages ────────────────────────────────────────────
async function setupLandlordMessages(user) {
  const container = document.getElementById('adminChats');
  document.getElementById('tenantChat').hidden = true;
  container.innerHTML = '<p class="info-text">Učitavam stanove...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'units'), where('ownerId', '==', user.uid)));
    container.innerHTML = '';
    if (snap.empty) {
      container.innerHTML = '<p class="info-text">Nemate stanova u bazi.</p>';
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
          <div class="chat-header-meta">
            <small><span class="unit-label">Zakupac:</span> ${unit.tenantEmail || 'bez zakupca'}</small>
          </div>
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
        snapshot.forEach(m => renderMessage(box, m.data(), true, user.email));
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
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: user.email, tekst, vreme: serverTimestamp() });
    });
    container.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.admin-msg-input');
      if (!input) return;
      const unitId = input.dataset.unit;
      const tekst  = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: user.email, tekst, vreme: serverTimestamp() });
    });
  } catch(err) {
    container.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
  }
}

// ── Kaskadno brisanje stana ──────────────────────────────────────
async function deleteUnitCascade(unitId) {
  const user          = auth.currentUser;
  const isMasterAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Briši subkolekcije (poruke, prihodi, troškovi)
  for (const sub of ['messages', 'income', 'expenses']) {
    try {
      const snap = await getDocs(collection(db, 'units', unitId, sub));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch(e) {
      console.warn(`Ne mogu obrisati ${sub}:`, e.message);
    }
  }

  // Kvarove briše samo master admin (landlord nema dozvolu po Rules)
  if (isMasterAdmin) {
    try {
      const kvarSnap = await getDocs(query(collection(db, 'kvarovi'), where('unitId', '==', unitId)));
      await Promise.all(kvarSnap.docs.map(d => deleteDoc(d.ref)));
    } catch(e) {
      console.warn('Ne mogu obrisati kvarove:', e.message);
    }
  }

  // Briši sam stan
  await deleteDoc(doc(db, 'units', unitId));
}

// ── User profili ─────────────────────────────────────────────────
async function saveUserProfile(user) {
  const ref = doc(db, 'users', user.uid);
  await setDoc(ref, {
    displayName: user.displayName || '',
    email:       user.email || '',
    photoURL:    user.photoURL || ''
  }, { merge: true });
}

// Učitaj profile više korisnika odjednom; vraća map uid -> {displayName, email}
async function getUserProfiles(uids) {
  const map = {};
  if (!uids.length) return map;
  const unique = [...new Set(uids)];
  await Promise.all(unique.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) map[uid] = snap.data();
    } catch(e) {}
  }));
  return map;
}

// Renderuj owner-sekciju (za listu stanova i poruke)
function renderOwnerSection(label, sublabel) {
  const section = document.createElement('div');
  section.className = 'owner-section';
  section.innerHTML = `
    <div class="owner-section-header">
      <i class="ti ti-user-circle"></i>
      <div>
        <span class="owner-section-name">${label}</span>
        <span class="owner-section-email">${sublabel}</span>
      </div>
    </div>
  `;
  return section;
}

// ── Units — lista (master admin) ─────────────────────────────────
async function loadUnits() {
  const ul   = document.getElementById('unitList');
  const form = document.getElementById('unitForm');
  ul.innerHTML = '';
  if (form) form.style.display = '';
  try {
    const snap = await getDocs(collection(db, 'units'));
    if (snap.empty) {
      ul.innerHTML = '<li style="color:var(--muted);font-size:14px">Nema unetih stanova.</li>';
      return;
    }
    const allDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));

    // Učitaj profile svih ownera
    const ownerIds = [...new Set(allDocs.map(d => d.data.ownerId).filter(Boolean))];
    const profiles = await getUserProfiles(ownerIds);

    // Grupiši po ownerId
    const myUid   = auth.currentUser.uid;
    const myUnits = allDocs.filter(d => d.data.ownerId === myUid);
    const others  = allDocs.filter(d => d.data.ownerId !== myUid);

    // Grupiši ostale po ownerId
    const byOwner = {};
    others.forEach(d => {
      const oid = d.data.ownerId || '__unknown__';
      if (!byOwner[oid]) byOwner[oid] = [];
      byOwner[oid].push(d);
    });

    // Sortiraj po displayName/email abecedno
    const ownerOrder = Object.keys(byOwner).sort((a, b) => {
      const na = (profiles[a]?.displayName || profiles[a]?.email || a).toLowerCase();
      const nb = (profiles[b]?.displayName || profiles[b]?.email || b).toLowerCase();
      return na.localeCompare(nb);
    });

    // Moji stanovi
    if (myUnits.length) {
      const myProfile = profiles[myUid];
      const myName    = myProfile?.displayName || 'Master Admin';
      const myEmail   = myProfile?.email || auth.currentUser.email;
      ul.appendChild(renderOwnerSection(myName, myEmail));
      myUnits.forEach(d => ul.appendChild(buildUnitLi(d.id, d.data, true)));
    }

    // Stanovi ostalih landlordova
    ownerOrder.forEach(oid => {
      const p     = profiles[oid] || {};
      const name  = p.displayName || '—';
      const email = p.email || oid;
      ul.appendChild(renderOwnerSection(name, email));
      byOwner[oid].forEach(d => ul.appendChild(buildUnitLi(d.id, d.data, true)));
    });

  } catch(e) {
    ul.innerHTML = '<li>Greška pri učitavanju — proveri Firestore Rules.</li>';
    console.error(e);
  }
}

document.getElementById('unitForm').onsubmit = async e => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  await addDoc(collection(db, 'units'), {
    name:        document.getElementById('unitName').value.trim(),
    tenantEmail: document.getElementById('tenantEmail').value.trim().toLowerCase(),
    ownerId:     user.uid,
    ownerEmail:  user.email.toLowerCase()
  });
  e.target.reset();
  // Nakon dodavanja stana korisnik je landlord — uvek reload kao landlord
  await loadUnitsLandlord(user);
  const isMasterAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (isMasterAdmin) setupAdminMessages();
  else setupLandlordMessages(user);
};

// ── Unit — detalji ──────────────────────────────────────────────
let currentUnitId = null;

async function openUnitDetail(unitId, baseData) {
  currentUnitId = unitId;
  document.getElementById('detailUnitName').textContent = baseData.name;
  showUnitDetail();

  // Proveri da li je trenutni korisnik vlasnik stana
  const user      = auth.currentUser;
  const isOwner   = user && (baseData.ownerId === user.uid || user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  const saveBtn   = document.getElementById('saveUnitDetail');
  const detailForm = document.getElementById('unitDetailForm');

  // Prikaži/sakrij dugme za čuvanje i read-only state
  if (saveBtn)    saveBtn.style.display    = isOwner ? '' : 'none';
  if (detailForm) {
    detailForm.querySelectorAll('input, select, textarea').forEach(el => {
      el.disabled = !isOwner;
    });
  }

  // Prikaz read-only napomene za zakupca
  let roNote = document.getElementById('detailReadonlyNote');
  if (!isOwner) {
    if (!roNote) {
      roNote = document.createElement('p');
      roNote.id = 'detailReadonlyNote';
      roNote.className = 'info-text';
      roNote.style.cssText = 'margin-bottom:8px;font-size:13px';
      roNote.textContent = 'Detalje stana može menjati samo vlasnik.';
      detailForm?.prepend(roNote);
    }
  } else {
    roNote?.remove();
  }

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
    document.getElementById('dTenantEmail').value   = d.tenantEmail || '';
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
  // Sigurnosna provjera — samo vlasnik ili admin može sačuvati
  const user = auth.currentUser;
  const snap0 = await getDoc(doc(db, 'units', currentUnitId));
  const unitData0 = snap0.exists() ? snap0.data() : {};
  const isOwner = user && (unitData0.ownerId === user.uid || user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!isOwner) { alert('Nemate dozvolu za izmenu detalja ovog stana.'); return; }
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
    // Osvježi listu prema ulozi
    const isMasterAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (isMasterAdmin) await loadUnits();
    else await loadUnitsLandlord(user);
    // Vrati na listu stanova
    showUnitList();
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
  container.innerHTML = '<p class="info-text">Učitavam...</p>';
  try {
    const snap = await getDocs(collection(db, 'units'));
    container.innerHTML = '';
    if (snap.empty) { container.innerHTML = '<p class="info-text">Nema stanova u bazi.</p>'; return; }

    const allDocs  = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    const ownerIds = [...new Set(allDocs.map(d => d.data.ownerId).filter(Boolean))];
    const profiles = await getUserProfiles(ownerIds);

    const myUid   = auth.currentUser.uid;
    const myUnits = allDocs.filter(d => d.data.ownerId === myUid);
    const others  = allDocs.filter(d => d.data.ownerId !== myUid);

    const byOwner = {};
    others.forEach(d => {
      const oid = d.data.ownerId || '__unknown__';
      if (!byOwner[oid]) byOwner[oid] = [];
      byOwner[oid].push(d);
    });
    const ownerOrder = Object.keys(byOwner).sort((a, b) => {
      const na = (profiles[a]?.displayName || profiles[a]?.email || a).toLowerCase();
      const nb = (profiles[b]?.displayName || profiles[b]?.email || b).toLowerCase();
      return na.localeCompare(nb);
    });

    const renderGroup = (groupDocs, ownerLabel, ownerEmail) => {
      container.appendChild(renderOwnerSection(ownerLabel, ownerEmail));
      groupDocs.forEach(({ id: unitId, data: unit }) => {
        const card = document.createElement('div');
        card.className = 'chat-card';
        card.innerHTML = `
          <div class="chat-card-header">
            <i class="ti ti-home"></i>
            <span>${unit.name}</span>
            <div class="chat-header-meta">
              <small><span class="unit-label">Zakupac:</span> ${unit.tenantEmail || 'bez zakupca'}</small>
            </div>
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
        const q = query(collection(db, 'units', unitId, 'messages'), orderBy('vreme', 'asc'));
        onSnapshot(q, snapshot => {
          const box = document.getElementById('msgs-' + unitId);
          if (!box) return;
          box.innerHTML = '';
          snapshot.forEach(m => renderMessage(box, m.data(), true));
          box.scrollTop = box.scrollHeight;
        });
      });
    };

    if (myUnits.length) {
      const p = profiles[myUid] || {};
      renderGroup(myUnits, p.displayName || 'Master Admin', p.email || auth.currentUser.email);
    }
    ownerOrder.forEach(oid => {
      const p = profiles[oid] || {};
      renderGroup(byOwner[oid], p.displayName || '—', p.email || oid);
    });

    container.addEventListener('click', async e => {
      const btn = e.target.closest('.admin-msg-send');
      if (!btn) return;
      const unitId = btn.dataset.unit;
      const input  = container.querySelector('.admin-msg-input[data-unit="' + unitId + '"]');
      const tekst  = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: auth.currentUser.email, tekst, vreme: serverTimestamp() });
    });
    container.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.admin-msg-input');
      if (!input) return;
      const unitId = input.dataset.unit;
      const tekst  = input.value.trim();
      if (!tekst) return;
      input.value = '';
      await addDoc(collection(db, 'units', unitId, 'messages'), { od: auth.currentUser.email, tekst, vreme: serverTimestamp() });
    });
  } catch(err) {
    container.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
    console.error(err);
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
    const unitData = unitDoc.data();

    // Učitaj profil vlasnika
    let ownerLabel = '—';
    if (unitData.ownerId) {
      try {
        const ownerSnap = await getDoc(doc(db, 'users', unitData.ownerId));
        if (ownerSnap.exists()) {
          const op = ownerSnap.data();
          ownerLabel = op.displayName ? `${op.displayName} (${op.email})` : (op.email || unitData.ownerEmail || '—');
        } else {
          ownerLabel = unitData.ownerEmail || '—';
        }
      } catch(e) {
        ownerLabel = unitData.ownerEmail || '—';
      }
    } else if (unitData.ownerEmail) {
      ownerLabel = unitData.ownerEmail;
    }

    header.innerHTML = `
      <span class="tenant-chat-unit">${unitData.name}</span>
      <span class="tenant-chat-owner"><span class="unit-label">Vlasnik:</span> ${ownerLabel}</span>
    `;
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

// ── Dashboard totali ─────────────────────────────────────────────
async function loadDashboard(ownerId = null) {
  const isMasterAdmin = !ownerId && auth.currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const landlordEl = document.getElementById('dashboardLandlord');
  const adminEl    = document.getElementById('dashboardAdmin');
  if (landlordEl) landlordEl.style.display = isMasterAdmin ? 'none' : '';
  if (adminEl)    adminEl.style.display    = isMasterAdmin ? '' : 'none';

  if (!isMasterAdmin) {
    // Landlord — obični prikaz
    try {
      const { income, expense, profit, currency } = await getDashboardTotals(ownerId);
      const cur = currency || 'RSD';
      document.getElementById('income').textContent  = income.toLocaleString('sr-Latn',  { maximumFractionDigits: 2 }) + ' ' + cur;
      document.getElementById('expense').textContent = expense.toLocaleString('sr-Latn', { maximumFractionDigits: 2 }) + ' ' + cur;
      document.getElementById('profit').textContent  = profit.toLocaleString('sr-Latn',  { maximumFractionDigits: 2 }) + ' ' + cur;
    } catch(e) {}
    return;
  }

  // Master admin — prikaz po grupama
  const summaryEl  = document.getElementById('dashboardSummary');
  const groupsEl   = document.getElementById('dashboardGroups');
  if (!summaryEl || !groupsEl) return; // stari HTML, skip

  summaryEl.innerHTML = '<p class="info-text">Učitavam...</p>';
  groupsEl.innerHTML  = '';

  try {
    const snap     = await getDocs(collection(db, 'units'));
    const allDocs  = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    const ownerIds = [...new Set(allDocs.map(d => d.data.ownerId).filter(Boolean))];
    const profiles = await getUserProfiles(ownerIds);
    const myUid    = auth.currentUser.uid;

    const myUnits = allDocs.filter(d => d.data.ownerId === myUid);
    const byOwner = {};
    allDocs.filter(d => d.data.ownerId !== myUid).forEach(d => {
      const oid = d.data.ownerId || '__unknown__';
      if (!byOwner[oid]) byOwner[oid] = [];
      byOwner[oid].push(d);
    });
    const ownerOrder = Object.keys(byOwner).sort((a, b) => {
      const na = (profiles[a]?.displayName || profiles[a]?.email || a).toLowerCase();
      const nb = (profiles[b]?.displayName || profiles[b]?.email || b).toLowerCase();
      return na.localeCompare(nb);
    });

    // Ukupno za sve
    const totals = await getDashboardTotals(null);
    const cur    = totals.currency || 'RSD';
    summaryEl.innerHTML = `
      <div class="dash-total-row">
        <div class="dash-kpi"><span class="dash-kpi-label">Ukupni prihod</span><span class="dash-kpi-val green">${totals.income.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
        <div class="dash-kpi"><span class="dash-kpi-label">Ukupni rashod</span><span class="dash-kpi-val red">${totals.expense.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
        <div class="dash-kpi"><span class="dash-kpi-label">Neto profit</span><span class="dash-kpi-val ${totals.profit>=0?'green':'red'}">${totals.profit.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
      </div>
    `;

    // Render po grupama
    const renderDashGroup = async (units, name, email) => {
      let inc = 0, exp = 0;
      for (const u of units) {
        const t = await getDashboardTotals(u.data.ownerId);
        // Zapravo trebamo per-unit sums — koristimo getDashboardTotals po unitId
      }
      // Koristimo ownerId filter
      const oid = units[0]?.data?.ownerId;
      const t   = oid ? await getDashboardTotals(oid) : { income:0, expense:0, profit:0, currency: cur };
      const section = document.createElement('div');
      section.className = 'dash-owner-section';
      section.innerHTML = `
        <div class="owner-section-header">
          <i class="ti ti-user-circle"></i>
          <div>
            <span class="owner-section-name">${name}</span>
            <span class="owner-section-email">${email}</span>
          </div>
        </div>
        <div class="dash-kpi-row">
          <div class="dash-kpi"><span class="dash-kpi-label">Prihod</span><span class="dash-kpi-val green">${t.income.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
          <div class="dash-kpi"><span class="dash-kpi-label">Rashod</span><span class="dash-kpi-val red">${t.expense.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
          <div class="dash-kpi"><span class="dash-kpi-label">Profit</span><span class="dash-kpi-val ${t.profit>=0?'green':'red'}">${t.profit.toLocaleString('sr-Latn',{maximumFractionDigits:2})} ${cur}</span></div>
        </div>
        <ul class="dash-unit-list">${units.map(u=>`<li>${u.data.name}</li>`).join('')}</ul>
      `;
      groupsEl.appendChild(section);
    };

    if (myUnits.length) {
      const p = profiles[myUid] || {};
      await renderDashGroup(myUnits, p.displayName || 'Master Admin', p.email || auth.currentUser.email);
    }
    for (const oid of ownerOrder) {
      const p = profiles[oid] || {};
      await renderDashGroup(byOwner[oid], p.displayName || '—', p.email || oid);
    }
  } catch(e) {
    summaryEl.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
    console.error(e);
  }
}

// ── Osvježi dashboard kad se promeni valuta u Finansijama ──────
let currentOwnerUid = null;
window.addEventListener('finance:currencyChanged', () => loadDashboard(currentOwnerUid));

// ── MSG SUB-TABOVI ──────────────────────────────────────────────
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
    // Učitaj podatke kad se otvori kvar tab
    if (btn.dataset.subtab === 'kvar') {
      const user = auth.currentUser;
      if (!user) return;
      const isMasterAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      if (isMasterAdmin) { loadKvarAdmin(); return; }
      // Proveri da li je landlord
      getDocs(query(collection(db, 'units'), where('ownerId', '==', user.uid)))
        .then(snap => {
          if (!snap.empty) loadKvarAdmin();
          else loadKvarTenantHistory(user);
        })
        .catch(() => loadKvarTenantHistory(user));
    }
  };
});

// ── PRIJAVA KVARA — podaci ──────────────────────────────────────
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

const KVAR_IKONE = {
  uredjaj: 'ti-plug', struja: 'ti-bolt', lom: 'ti-hammer', havarija: 'ti-droplet'
};
const KVAR_NAZIVI = {
  uredjaj: 'Kvar na uređaju', struja: 'Problem sa strujom',
  lom: 'Prijava loma', havarija: 'Havarija'
};

let kvarTip = 'uredjaj';
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

// ── SUBMIT prijave kvara (zakupac) ──────────────────────────────
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
    const unitName = snap.docs[0].data().name;

    await addDoc(collection(db, 'kvarovi'), {
      unitId, unitName,
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
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-send"></i> Pošalji prijavu';
    }, 2000);
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Pošalji prijavu';
    alert('Greška: ' + e.message);
  }
};

// ── Istorija kvarova — zakupac ───────────────────────────────────
async function loadKvarTenantHistory(user) {
  const container = document.getElementById('kvarTenantHistory');
  if (!container) return;
  container.innerHTML = '<p class="info-text">Učitavam...</p>';
  try {
    const q    = query(collection(db, 'kvarovi'),
                       where('tenantEmail', '==', user.email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) { container.innerHTML = '<p class="info-text">Nema prijava.</p>'; return; }
    container.innerHTML = '';
    const docs = [];
    snap.forEach(d => docs.push({ id: d.id, data: d.data() }));
    docs.sort((a, b) => {
      const ta = a.data.vreme?.toDate ? a.data.vreme.toDate() : new Date(0);
      const tb = b.data.vreme?.toDate ? b.data.vreme.toDate() : new Date(0);
      return tb - ta;
    });
    docs.forEach(d => container.appendChild(renderKvarItem(d.id, d.data, false)));
  } catch(e) {
    container.innerHTML = '<p class="info-text">Nema prijava.</p>';
    console.error('loadKvarTenantHistory:', e);
  }
}

// ── Lista kvarova — admin ────────────────────────────────────────
async function loadKvarAdmin() {
  const list  = document.getElementById('kvarAdminList');
  const empty = document.getElementById('kvarAdminEmpty');
  list.innerHTML = '';
  empty.textContent = 'Učitavam prijave...';
  try {
    const q    = query(collection(db, 'kvarovi'), orderBy('vreme', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) { empty.textContent = 'Nema prijavljenih kvarova.'; return; }
    empty.textContent = '';
    snap.forEach(d => list.appendChild(renderKvarItem(d.id, d.data(), true)));
  } catch(e) {
    empty.textContent = 'Greška pri učitavanju.';
  }
}

// ── Render jedne prijave ─────────────────────────────────────────
function renderKvarItem(id, data, isAdmin) {
  const div = document.createElement('div');
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
      ${data.status === 'reseno' ? `<button class="kvar-delete-btn" data-id="${id}" title="Obriši prijavu"><i class="ti ti-trash"></i></button>` : ''}
    </div>
    ${data.opis ? `<div class="kvar-item-opis">${data.opis}</div>` : ''}
  `;
  if (isAdmin) {
    div.querySelector('.kvar-status-toggle').onclick = async (e) => {
      const btn2 = e.currentTarget;
      const noviStatus = btn2.dataset.status === 'reseno' ? 'otvoreno' : 'reseno';
      btn2.disabled = true;
      try {
        await setDoc(doc(db, 'kvarovi', id), { status: noviStatus }, { merge: true });
        loadKvarAdmin();
      } catch(err) {
        alert('Greška: ' + err.message);
        btn2.disabled = false;
      }
    };
  }
  const deleteBtn = div.querySelector('.kvar-delete-btn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm('Obriši ovu prijavu kvara? Akcija je nepovratna.')) return;
      try {
        await deleteDoc(doc(db, 'kvarovi', id));
        if (isAdmin) loadKvarAdmin();
        else {
          const user = auth.currentUser;
          if (user) loadKvarTenantHistory(user);
        }
      } catch(err) {
        alert('Greška: ' + err.message);
      }
    };
  }
  return div;
}

// ── Prikaži kvar view za zakupca ili admina ──────────────────────
function setupKvarView(user, role) {
  const showAdmin = (role === 'masterAdmin' || role === 'landlord');
  document.getElementById('kvarAdminView').hidden  = !showAdmin;
  document.getElementById('kvarTenantView').hidden = showAdmin;

  if (!showAdmin) {
    const stanEl = document.getElementById('kvarStanNaziv');
    if (stanEl) {
      getDocs(query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase())))
        .then(snap => {
          if (snap.empty) {
            stanEl.textContent = 'Nemate dodeljen stan';
            stanEl.style.color = 'var(--muted)';
          } else {
            stanEl.textContent = snap.docs[0].data().name;
            stanEl.style.color = '';
          }
        })
        .catch(() => { stanEl.textContent = '—'; });
    }
    // Učitaj istoriju kvarova za tenant/new (new nema kvarova — prikazaće "Nema prijava")
    loadKvarTenantHistory(user);
  }
}
