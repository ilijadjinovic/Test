import { auth, db, login, logout, MASTER_ADMIN_UID, MASTER_ADMIN_EMAIL } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { setupFinance, getDashboardTotals, showFinanceList } from './finance.js';

document.getElementById('loginBtn').onclick  = login;
document.getElementById('logoutBtn').onclick = logout;

// ── Inicijalni state — prikaži samo Profil, sve ostalo sakrijeno ─
document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
['dashboard', 'units', 'messages', 'finance'].forEach(id => {
  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  if (btn) btn.style.display = 'none';
});
document.getElementById('profil').classList.add('active');
document.querySelector('.tab[data-tab="profil"]').classList.add('active');
document.getElementById('contextSwitcher').style.display = 'none';

// ── Tab navigation ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    const tabId = b.dataset.tab;
    if (b.style.display === 'none') return;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    updateSwitcherVisibility(tabId);
    if (tabId === 'units') {
      if (currentContext === 'tenant') {
        setupTenantUnitSection(currentUser);
      } else {
        showUnitList();
      }
    }
    if (tabId === 'finance') showFinanceList();
  };
});

function updateSwitcherVisibility(tabId) {
  const switcher = document.getElementById('contextSwitcher');
  const show = currentUser && document.body.dataset.ctxSwitcher === 'true' && tabId !== 'profil';
  switcher.style.display = show ? 'flex' : 'none';
}

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

// ── Context switcher (landlord ↔ zakupac) ────────────────────────
let currentContext = 'landlord'; // 'landlord' | 'tenant'
let currentUser    = null;

document.getElementById('ctxLandlordBtn').onclick = () => { if (currentUser) switchContext('landlord'); };
document.getElementById('ctxTenantBtn').onclick   = () => { if (currentUser) switchContext('tenant'); };

function switchContext(ctx) {
  currentContext = ctx;
  sessionStorage.setItem('rmContext', ctx);
  document.getElementById('ctxLandlordBtn').classList.toggle('active', ctx === 'landlord');
  document.getElementById('ctxTenantBtn').classList.toggle('active', ctx === 'tenant');

  if (ctx === 'landlord') {
    showTab('dashboard');
    showTab('units');
    showTab('finance');
    // Ostani na Poruke tabu (dolazimo iz tenant konteksta)
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('messages').classList.add('active');
    document.querySelector('.tab[data-tab="messages"]').classList.add('active');
    loadUnits();
    setupAdminMessages(currentUser);
    setupFinance(currentUser.uid);
    loadDashboard();
    setupKvarView(currentUser);
  } else {
    hideTab('dashboard');
    hideTab('finance');
    showTab('units');
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('messages').classList.add('active');
    document.querySelector('.tab[data-tab="messages"]').classList.add('active');
    setupTenantMessages(currentUser);
    setupKvarView(currentUser);
    // Prikaži standardnu units listu (ne tenant sekciju)
    document.getElementById('tenantUnitSection').hidden = true;
    document.getElementById('unitsListView').hidden = false;
    document.getElementById('unitDetailView').hidden = true;
  }
}

function showContextSwitcher(hasLandlord, hasTenant) {
  if (currentUser && hasLandlord && hasTenant) {
    document.body.dataset.ctxSwitcher = 'true';
  } else {
    document.body.dataset.ctxSwitcher = 'false';
  }
  // Prikaži na trenutnom tabu ako treba
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  updateSwitcherVisibility(activeTab || 'profil');
}

// ── Auth state ───────────────────────────────────────────────────
let unsubscribeMessages = null;

onAuthStateChanged(auth, async user => {
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  currentUser = user;
  updateProfileTab(user);

  if (!user) {
    ['dashboard', 'units', 'messages', 'finance'].forEach(id => hideTab(id));
    document.body.dataset.ctxSwitcher = 'false';
    document.getElementById('contextSwitcher').style.display = 'none';
    sessionStorage.removeItem('rmContext');
    return;
  }

  const isMasterAdmin = user.uid === MASTER_ADMIN_UID;

  // Provjeri da li je landlord (ima stanove) i/ili zakupac (dodeljen stanu)
  const [landlordSnap, tenantSnap] = await Promise.all([
    getDocs(query(collection(db, 'units'), where('ownerId', '==', user.uid))),
    getDocs(query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase())))
  ]);

  // Master admin uvek vidi sve kao landlord, čak i bez stanova
  const hasLandlord = isMasterAdmin || !landlordSnap.empty;
  const hasTenant   = !tenantSnap.empty;

  console.log('[RM] hasLandlord:', hasLandlord, '| hasTenant:', hasTenant, '| email:', user.email);
  showContextSwitcher(hasLandlord, hasTenant);
  showTab('messages');

  if (hasLandlord) {
    // Defaultno landlord kontekst, osim ako je korisnik prethodno bio u tenant modu
    const savedCtx = sessionStorage.getItem('rmContext');
    const startAsTenant = hasTenant && savedCtx === 'tenant';

    if (startAsTenant) {
      // Vrati u tenant kontekst
      currentContext = 'tenant';
      document.getElementById('ctxLandlordBtn').classList.remove('active');
      document.getElementById('ctxTenantBtn').classList.add('active');
      showTab('dashboard'); showTab('units'); showTab('finance');
      hideTab('dashboard'); hideTab('finance');
      showTab('units');
      document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.getElementById('messages').classList.add('active');
      document.querySelector('.tab[data-tab="messages"]').classList.add('active');
      setupTenantMessages(user);
      setupKvarView(user);
      setupTenantUnitSection(user);
      setupAdminMessages(user);
      setupFinance(user.uid);
    } else {
      // Landlord kontekst (default)
      currentContext = 'landlord';
      sessionStorage.setItem('rmContext', 'landlord');
      document.getElementById('ctxLandlordBtn').classList.add('active');
      document.getElementById('ctxTenantBtn').classList.remove('active');

      showTab('dashboard');
      showTab('units');
      showTab('finance');

      document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));

      // Ako nema stanova (novi landlord) — prikaži units tab sa onboarding porukom
      if (!isMasterAdmin && landlordSnap.empty) {
        document.getElementById('units').classList.add('active');
        document.querySelector('.tab[data-tab="units"]').classList.add('active');
        showOnboarding();
      } else {
        document.getElementById('dashboard').classList.add('active');
        document.querySelector('.tab[data-tab="dashboard"]').classList.add('active');
        loadUnits();
        setupAdminMessages(user);
        setupFinance(user.uid);
        loadDashboard();
      }
    }
    setupKvarView(user);
  } else if (hasTenant) {
    // Zakupac bez vlastitih stanova — vidi Poruke + Stanovi (prazna lista + forma za dodavanje)
    currentContext = 'tenant';
    hideTab('dashboard');
    hideTab('finance');
    showTab('units');

    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('messages').classList.add('active');
    document.querySelector('.tab[data-tab="messages"]').classList.add('active');
    setupTenantMessages(user);
    setupKvarView(user);

    // Prikaži admin units listu (prazna) sa formom za dodavanje
    document.getElementById('tenantUnitSection').hidden = true;
    document.getElementById('unitsListView').hidden = false;
    document.getElementById('unitDetailView').hidden = true;
    showOnboarding();
  } else {
    // Nov korisnik — nije ni landlord ni zakupac još
    showTab('dashboard');
    showTab('units');
    showTab('finance');

    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('units').classList.add('active');
    document.querySelector('.tab[data-tab="units"]').classList.add('active');
    showOnboarding();
  }
});

// ── Onboarding za novog landlorda ────────────────────────────────
function showOnboarding() {
  const listView = document.getElementById('unitsListView');
  listView.hidden = false;
  document.getElementById('unitDetailView').hidden = true;

  // Prikaži poruku iznad forme
  let ob = document.getElementById('onboardingMsg');
  if (!ob) {
    ob = document.createElement('div');
    ob.id = 'onboardingMsg';
    ob.className = 'onboarding-msg';
    ob.innerHTML = `
      <i class="ti ti-home-plus"></i>
      <p>Dobrodošli u Rental Manager!</p>
      <span>Dodajte prvi stan da biste počeli sa upravljanjem.</span>
    `;
    listView.insertBefore(ob, listView.firstChild);
  }
}

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
  } else {
    guest.style.display     = 'block';
    userDiv.style.display   = 'none';
    topAvatar.style.display = 'none';
    document.querySelector('[data-tab="profil"] i').className = 'ti ti-user-circle';
  }
}

// ── Units — lista ────────────────────────────────────────────────
async function loadUnits() {
  const ul = document.getElementById('unitList');
  ul.innerHTML = '';

  // Ukloni onboarding ako postoji
  const ob = document.getElementById('onboardingMsg');
  if (ob) ob.remove();

  try {
    const isMaster = currentUser.uid === MASTER_ADMIN_UID;
    const q = isMaster
      ? collection(db, 'units')
      : query(collection(db, 'units'), where('ownerId', '==', currentUser.uid));
    const snap = await getDocs(q);
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
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-unit')) return;
        openUnitDetail(d.id, data);
      });
      li.querySelector('.btn-delete-unit').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Obriši stan "${data.name}"? Ova akcija je nepovratna.`)) return;
        try {
          await deleteDoc(doc(db, 'units', d.id));
          await loadUnits();
          setupAdminMessages(currentUser);
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

document.getElementById('unitForm').onsubmit = async e => {
  e.preventDefault();
  await addDoc(collection(db, 'units'), {
    name:        document.getElementById('unitName').value.trim(),
    rent:        Number(document.getElementById('unitRent').value || 0),
    tenantEmail: document.getElementById('tenantEmail').value.trim().toLowerCase(),
    ownerId:     currentUser.uid  // ← ključno polje
  });
  e.target.reset();
  // Ukloni onboarding poruku nakon dodavanja prvog stana
  const ob = document.getElementById('onboardingMsg');
  if (ob) ob.remove();
  await loadUnits();
  setupAdminMessages(currentUser);
  // Ako je bio novi korisnik, sad pokazi sve tabove
  showTab('dashboard');
  showTab('finance');
  setupFinance(currentUser.uid);
};

// ── Unit — detalji ───────────────────────────────────────────────
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
      ownerId:     currentUser.uid  // čuvamo ownerId i pri update
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

// ── Admin messages ───────────────────────────────────────────────
async function setupAdminMessages(user) {
  const container = document.getElementById('adminChats');
  document.getElementById('tenantChat').hidden = true;
  container.innerHTML = '<p class="info-text">Učitavam stanove...</p>';
  try {
    const isMaster = user.uid === MASTER_ADMIN_UID;
    const q = isMaster
      ? collection(db, 'units')
      : query(collection(db, 'units'), where('ownerId', '==', user.uid));
    const snap = await getDocs(q);
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
      const mq = query(msgsRef, orderBy('vreme', 'asc'));
      onSnapshot(mq, snapshot => {
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

// ── Render poruke ────────────────────────────────────────────────
function renderMessage(container, data, isAdmin, currentUserEmail) {
  const div = document.createElement('div');
  const isMe = data.od === currentUserEmail;
  div.className = 'chat-bubble ' + (isMe ? 'bubble-me' : 'bubble-them');
  div.textContent = data.tekst;
  container.appendChild(div);
}

// ── Dashboard totali ─────────────────────────────────────────────
async function loadDashboard() {
  try {
    const { income, expense, profit, currency } = await getDashboardTotals(currentUser.uid);
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
    if (btn.dataset.subtab === 'kvar' && currentUser) {
      const isMaster   = currentUser.uid === MASTER_ADMIN_UID;
      const isLandlord = currentContext === 'landlord';
      if (isMaster || isLandlord) loadKvarAdmin();
      else loadKvarTenantHistory(currentUser);
    }
  };
});

// ── PRIJAVA KVARA — podaci ───────────────────────────────────────
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
const KVAR_IKONE  = { uredjaj:'ti-plug', struja:'ti-bolt', lom:'ti-hammer', havarija:'ti-droplet' };
const KVAR_NAZIVI = { uredjaj:'Kvar na uređaju', struja:'Problem sa strujom', lom:'Prijava loma', havarija:'Havarija' };

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

// ── Submit prijave kvara (zakupac) ───────────────────────────────
document.getElementById('kvarSubmitBtn').onclick = async () => {
  const stavka = document.getElementById('kvarStavka').value;
  const opis   = document.getElementById('kvarOpis').value.trim();
  if (!stavka) { alert('Izaberi stavku!'); return; }

  const btn = document.getElementById('kvarSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Šaljem...';

  try {
    const user = currentUser;
    const q    = query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) { alert('Nemate dodeljen stan.'); btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Pošalji prijavu'; return; }
    const unitDoc  = snap.docs[0];
    const unitId   = unitDoc.id;
    const unitName = unitDoc.data().name;
    const ownerId  = unitDoc.data().ownerId;

    await addDoc(collection(db, 'kvarovi'), {
      unitId, unitName, ownerId,
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
    setTimeout(() => { btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Pošalji prijavu'; }, 2000);
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
    const isMaster = currentUser.uid === MASTER_ADMIN_UID;
    const q = isMaster
      ? query(collection(db, 'kvarovi'), orderBy('vreme', 'desc'))
      : query(collection(db, 'kvarovi'), where('ownerId', '==', currentUser.uid), orderBy('vreme', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) { empty.textContent = 'Nema prijavljenih kvarova.'; return; }
    empty.textContent = '';
    snap.forEach(d => list.appendChild(renderKvarItem(d.id, d.data(), true)));
  } catch(e) {
    empty.textContent = 'Greška pri učitavanju.';
  }
}

// ── Render jedne prijave ─────────────────────────────────────────
function renderKvarItem(id, data, isLandlord) {
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
      ${isLandlord ? `<span class="kvar-item-unit">${data.unitName || data.unitId}</span>` : ''}
      <span class="kvar-badge status ${data.status === 'reseno' ? 'reseno' : ''}">${data.status === 'reseno' ? '✓ Rešeno' : '⏳ Otvoreno'}</span>
      ${isLandlord ? `<button class="kvar-status-toggle" data-id="${id}" data-status="${data.status}">${data.status === 'reseno' ? 'Ponovo otvori' : 'Označi rešeno'}</button>` : ''}
    </div>
    ${data.opis ? `<div class="kvar-item-opis">${data.opis}</div>` : ''}
  `;
  if (isLandlord) {
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
  return div;
}


// ── Zakupac — sekcija Stanovi ─────────────────────────────────────
async function setupTenantUnitSection(user) {
  const section = document.getElementById('tenantUnitSection');
  const infoDiv = document.getElementById('tenantUnitInfo');
  const formDiv = document.getElementById('tenantAddUnitForm');

  // Sakrij admin dijelove, prikaži tenant sekciju
  document.getElementById('unitsListView').hidden  = true;
  document.getElementById('unitDetailView').hidden = true;
  section.hidden = false;

  infoDiv.innerHTML = '<p class="info-text">Učitavam...</p>';
  formDiv.hidden = true;

  try {
    const q    = query(collection(db, 'units'), where('tenantEmail', '==', user.email.toLowerCase()));
    const snap = await getDocs(q);

    if (!snap.empty) {
      // Zakupac ima dodeljen stan — prikaži info
      const d = snap.docs[0].data();
      infoDiv.innerHTML = `
        <div class="tenant-unit-card">
          <div class="tenant-unit-card-header">
            <i class="ti ti-home-check"></i>
            <span>${d.name || 'Stan'}</span>
          </div>
          <div class="detail-form" style="margin-top:8px">
            ${d.adresa    ? `<div class="detail-row"><label>Adresa</label><span>${d.adresa}</span></div>` : ''}
            ${d.rent      ? `<div class="detail-row"><label>Renta</label><span>${d.rent.toLocaleString('sr')} ${d.valuta || 'RSD'}</span></div>` : ''}
            ${d.zakupOd   ? `<div class="detail-row"><label>Zakup od</label><span>${d.zakupOd}</span></div>` : ''}
            ${d.zakupDo   ? `<div class="detail-row"><label>Zakup do</label><span>${d.zakupDo}</span></div>` : ''}
          </div>
        </div>
      `;
      formDiv.hidden = true;
    } else {
      // Nema dodeljenog stana — prikaži formu za zahtev
      infoDiv.innerHTML = '';
      formDiv.hidden = false;
    }

    // Uvek prikaži opciju da korisnik postane landlord (doda vlastiti stan)
    let becomeLandlordDiv = document.getElementById('becomeLandlordSection');
    if (!becomeLandlordDiv) {
      becomeLandlordDiv = document.createElement('div');
      becomeLandlordDiv.id = 'becomeLandlordSection';
      becomeLandlordDiv.style.marginTop = '16px';
      becomeLandlordDiv.innerHTML = `
        <div class="onboarding-msg">
          <i class="ti ti-building-plus"></i>
          <p>Imate vlastiti stan za izdavanje?</p>
          <span>Možete dodati vlastiti stan i upravljati zakupcima.</span>
          <button id="becomeLandlordBtn" class="btn-primary" style="margin-top:8px">
            <i class="ti ti-plus"></i> Dodaj vlastiti stan
          </button>
        </div>
      `;
      section.appendChild(becomeLandlordDiv);
      document.getElementById('becomeLandlordBtn').onclick = () => {
        // Postavi korisnika kao landlorda i prikaži onboarding
        currentContext = 'landlord';
        sessionStorage.setItem('rmContext', 'landlord');
        document.getElementById('ctxLandlordBtn')?.classList.add('active');
        document.getElementById('ctxTenantBtn')?.classList.remove('active');
        showTab('dashboard');
        showTab('finance');
        // Prikaži context switcher
        document.body.dataset.ctxSwitcher = 'true';
        // Sakrij tenant sekciju, prikaži admin listu sa onboarding formom
        section.hidden = true;
        document.getElementById('unitsListView').hidden = false;
        document.getElementById('unitDetailView').hidden = true;
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.getElementById('units').classList.add('active');
        document.querySelector('.tab[data-tab="units"]').classList.add('active');
        showOnboarding();
        setupAdminMessages(currentUser);
        setupFinance(currentUser.uid);
      };
    }
  } catch(e) {
    infoDiv.innerHTML = '<p class="info-text">Greška pri učitavanju.</p>';
    formDiv.hidden = false;
  }
}

// Forma za zahtev stanodavcu (zakupac)
document.getElementById('tenantUnitForm').onsubmit = async e => {
  e.preventDefault();
  const adresa         = document.getElementById('tuAdresa').value.trim();
  const landlordEmail  = document.getElementById('tuLandlordEmail').value.trim().toLowerCase();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Šaljem...';
  try {
    // Sačuvaj zahtev u Firestore — stanodavac može da vidi i doda zakupca
    await addDoc(collection(db, 'tenantRequests'), {
      tenantEmail:   currentUser.email.toLowerCase(),
      tenantName:    currentUser.displayName || '',
      landlordEmail,
      adresa,
      vreme:         serverTimestamp(),
      status:        'na_cekanju'
    });
    btn.innerHTML = '<i class="ti ti-check"></i> Zahtev poslat!';
    document.getElementById('tuAdresa').value = '';
    document.getElementById('tuLandlordEmail').value = '';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-send"></i> Pošalji zahtev stanodavcu';
    }, 3000);
  } catch(err) {
    alert('Greška: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Pošalji zahtev stanodavcu';
  }
};
  const isMaster   = user.uid === MASTER_ADMIN_UID;
  const isLandlord = currentContext === 'landlord';
  document.getElementById('kvarAdminView').hidden  = !(isMaster || isLandlord);
  document.getElementById('kvarTenantView').hidden = isMaster || isLandlord;
}
