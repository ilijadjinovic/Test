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

onAuthStateChanged(auth, user => {
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  updateProfileTab(user);

  if (!user) {
    // Gost: samo profil
    ['dashboard', 'units', 'messages', 'finance'].forEach(id => hideTab(id));
    return;
  }

  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (isAdmin) {
    // Admin: sve tabove
    showTab('dashboard');
    showTab('units');
    showTab('messages');
    showTab('finance');
    // Aktiviraj dashboard
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('dashboard').classList.add('active');
    document.querySelector('.tab[data-tab="dashboard"]').classList.add('active');
    loadUnits();
    setupAdminMessages();
    setupFinance();
    loadDashboard();
    setupKvarView(user);
  } else {
    // Zakupac: samo messages + profil
    hideTab('dashboard');
    hideTab('units');
    hideTab('finance');
    showTab('messages');
    // Aktiviraj messages
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.getElementById('messages').classList.add('active');
    document.querySelector('.tab[data-tab="messages"]').classList.add('active');
    setupTenantMessages(user);
    setupKvarView(user);
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

// ── Osvježi dashboard kad se promeni valuta u Finansijama ──────
window.addEventListener('finance:currencyChanged', () => loadDashboard());

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
      const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
      if (isAdmin) loadKvarAdmin();
      else loadKvarTenantHistory(user);
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
  return div;
}

// ── Prikaži kvar view za zakupca ili admina ──────────────────────
function setupKvarView(user) {
  const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  document.getElementById('kvarAdminView').hidden  = !isAdmin;
  document.getElementById('kvarTenantView').hidden = isAdmin;
}
