import { db, auth, ADMIN_EMAIL } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, deleteDoc,
  query, orderBy, Timestamp
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';

// ── Konstante ────────────────────────────────────────────────────
const FIXED_EXPENSE_TYPES = [
  { id: 'struja',     label: 'Struja',              icon: 'ti-bolt' },
  { id: 'infostan',   label: 'Infostan',             icon: 'ti-building-community' },
  { id: 'tvnet',      label: 'TV/NET',               icon: 'ti-wifi' },
  { id: 'odrzavanje', label: 'Održavanje zgrade',    icon: 'ti-tool' },
];
const VAR_EXPENSE_TYPES = [
  { id: 'servis',     label: 'Servis uređaja',       icon: 'ti-settings' },
  { id: 'namestaj',   label: 'Popravka nameštaja',   icon: 'ti-armchair' },
  { id: 'toalet',     label: 'Toaletni pribor',      icon: 'ti-basket' },
  { id: 'ciscenje',   label: 'Trošak čišćenja',      icon: 'ti-sparkles' },
  { id: 'ostalo',     label: 'Ostalo',               icon: 'ti-dots' },
];

const PERIODS = [
  { id: 'day',   label: 'Dan' },
  { id: 'week',  label: 'Sedmica' },
  { id: 'month', label: 'Mesec' },
  { id: 'year',  label: 'Godina' },
];

let currentFinanceUnit = null; // { id, data }
let financeExchangeRate = 117;  // default EUR→RSD
let financeDisplayCurrency = 'RSD';
let financePeriod = 'month';

// ── Entry point ──────────────────────────────────────────────────
export async function setupFinance() {
  // Učitaj postavke PRIJE generisanja HTML-a da bi se active klase pravilno renderovale
  await loadSettings();

  const section = document.getElementById('finance');
  section.innerHTML = `
    <div class="page-header">
      <h2>Finansije</h2>
      <span class="subtitle">Prihodi i rashodi</span>
    </div>

    <!-- Kurs + valuta prikaza -->
    <div class="fin-settings-bar">
      <div class="fin-setting-item">
        <label>Kurs EUR</label>
        <div class="fin-rate-wrap">
          <input id="finExchangeRate" type="number" value="${financeExchangeRate}" min="1" step="0.01">
          <span>RSD</span>
        </div>
      </div>
      <div class="fin-setting-item">
        <label>Prikaži u</label>
        <div class="fin-currency-toggle">
          <button class="fin-cur-btn ${financeDisplayCurrency==='RSD'?'active':''}" data-cur="RSD">RSD</button>
          <button class="fin-cur-btn ${financeDisplayCurrency==='EUR'?'active':''}" data-cur="EUR">EUR</button>
        </div>
      </div>
    </div>

    <!-- Period filter -->
    <div class="fin-period-bar">
      ${PERIODS.map(p=>`<button class="fin-period-btn ${financePeriod===p.id?'active':''}" data-period="${p.id}">${p.label}</button>`).join('')}
    </div>

    <!-- Lista stanova -->
    <div id="finUnitList"></div>

    <!-- Detalji stana -->
    <div id="finUnitDetail" hidden>
      <div class="detail-topbar">
        <button id="finBackBtn" class="btn-back">
          <i class="ti ti-arrow-left"></i>
          Nazad
        </button>
        <h3 id="finDetailTitle" class="detail-title"></h3>
      </div>

      <!-- Summary cards -->
      <div class="fin-summary-grid" id="finSummary"></div>

      <!-- Unos rente -->
      <div class="detail-section">
        <div class="detail-section-header">
          <i class="ti ti-trending-up"></i>
          Unos rente / prihoda
        </div>
        <div class="detail-form">
          <div class="detail-row">
            <label>Iznos</label>
            <input id="finIncomeAmount" type="number" placeholder="0">
          </div>
          <div class="detail-row">
            <label>Valuta</label>
            <select id="finIncomeCurrency">
              <option value="RSD">RSD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div class="detail-row">
            <label>Datum</label>
            <input id="finIncomeDate" type="date">
          </div>
          <div class="detail-row">
            <label>Napomena</label>
            <input id="finIncomeNote" placeholder="npr. renta januar">
          </div>
        </div>
        <div style="padding:0 12px 12px">
          <button id="finAddIncome" class="btn-primary">
            <i class="ti ti-plus"></i>
            Dodaj prihod
          </button>
        </div>
      </div>

      <!-- Unos fiksnih troškova -->
      <div class="detail-section">
        <div class="detail-section-header">
          <i class="ti ti-trending-down"></i>
          Fiksni troškovi
        </div>
        <div class="detail-form">
          <div class="detail-row">
            <label>Vrsta</label>
            <select id="finFixedType">
              ${FIXED_EXPENSE_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="detail-row">
            <label>Iznos</label>
            <input id="finFixedAmount" type="number" placeholder="0">
          </div>
          <div class="detail-row">
            <label>Valuta</label>
            <select id="finFixedCurrency">
              <option value="RSD">RSD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div class="detail-row">
            <label>Datum</label>
            <input id="finFixedDate" type="date">
          </div>
          <div class="detail-row">
            <label>Napomena</label>
            <input id="finFixedNote" placeholder="opis troška">
          </div>
        </div>
        <div style="padding:0 12px 12px">
          <button id="finAddFixed" class="btn-primary">
            <i class="ti ti-plus"></i>
            Dodaj fiksni trošak
          </button>
        </div>
      </div>

      <!-- Unos varijabilnih troškova -->
      <div class="detail-section">
        <div class="detail-section-header">
          <i class="ti ti-tool"></i>
          Varijabilni troškovi
        </div>
        <div class="detail-form">
          <div class="detail-row">
            <label>Vrsta</label>
            <select id="finVarType">
              ${VAR_EXPENSE_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="detail-row">
            <label>Iznos</label>
            <input id="finVarAmount" type="number" placeholder="0">
          </div>
          <div class="detail-row">
            <label>Valuta</label>
            <select id="finVarCurrency">
              <option value="RSD">RSD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div class="detail-row">
            <label>Datum</label>
            <input id="finVarDate" type="date">
          </div>
          <div class="detail-row">
            <label>Napomena</label>
            <input id="finVarNote" placeholder="opis troška">
          </div>
        </div>
        <div style="padding:0 12px 12px">
          <button id="finAddVar" class="btn-primary">
            <i class="ti ti-plus"></i>
            Dodaj varijabilni trošak
          </button>
        </div>
      </div>

      <!-- Istorija transakcija -->
      <div class="detail-section">
        <div class="detail-section-header">
          <i class="ti ti-list"></i>
          Istorija transakcija
        </div>
        <div id="finHistory" class="fin-history"></div>
      </div>
    </div>
  `;

  // ── Event listeneri ──────────────────────────────────────────
  // Kurs
  document.getElementById('finExchangeRate').addEventListener('input', async e => {
    financeExchangeRate = parseFloat(e.target.value) || 117;
    await saveSettings();
    if (currentFinanceUnit) refreshFinanceDetail();
  });

  // Valuta toggle
  section.querySelectorAll('.fin-cur-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      financeDisplayCurrency = btn.dataset.cur;
      section.querySelectorAll('.fin-cur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await saveSettings();
      window.dispatchEvent(new CustomEvent('finance:currencyChanged'));
      if (currentFinanceUnit) {
        refreshFinanceDetail();
      } else {
        loadFinanceUnitList();
      }
    });
  });

  // Period
  section.querySelectorAll('.fin-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      financePeriod = btn.dataset.period;
      section.querySelectorAll('.fin-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentFinanceUnit) refreshFinanceDetail();
    });
  });

  // Nazad
  document.getElementById('finBackBtn').addEventListener('click', () => {
    currentFinanceUnit = null;
    document.getElementById('finUnitList').hidden = false;
    document.getElementById('finUnitDetail').hidden = true;
    loadFinanceUnitList();
  });

  // Dodaj prihod
  document.getElementById('finAddIncome').addEventListener('click', addIncome);

  // Dodaj fiksni
  document.getElementById('finAddFixed').addEventListener('click', addFixedExpense);

  // Dodaj varijabilni
  document.getElementById('finAddVar').addEventListener('click', addVarExpense);

  // Postavi današnji datum kao default
  const today = todayStr();
  document.getElementById('finIncomeDate').value = today;
  document.getElementById('finFixedDate').value  = today;
  document.getElementById('finVarDate').value    = today;

  // Učitaj listu stanova
  await loadFinanceUnitList();
}

// ── Postavke (kurs, valuta) ──────────────────────────────────────
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'finance'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.exchangeRate) {
        financeExchangeRate = d.exchangeRate;
        document.getElementById('finExchangeRate').value = financeExchangeRate;
      }
      if (d.displayCurrency) {
        financeDisplayCurrency = d.displayCurrency;
        document.querySelectorAll('.fin-cur-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.cur === financeDisplayCurrency);
        });
      }
    }
  } catch(e) { /* tišina */ }
}

async function saveSettings() {
  try {
    await setDoc(doc(db, 'settings', 'finance'), {
      exchangeRate: financeExchangeRate,
      displayCurrency: financeDisplayCurrency
    }, { merge: true });
  } catch(e) { /* tišina */ }
}

// ── Lista stanova ───────────────────────────────────────────async function loadFinanceUnitList() {
  const listEl = document.getElementById('finUnitList');
  listEl.innerHTML = '<p class="info-text">Učitavam...</p>';
  try {
    const user         = auth.currentUser;
    const isMasterAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const snap          = await getDocs(collection(db, 'units'));
    listEl.innerHTML    = '';
    if (snap.empty) { listEl.innerHTML = '<p class="info-text">Nema stanova u bazi.</p>'; return; }

    const allDocs  = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    const ownerIds = [...new Set(allDocs.map(d => d.data.ownerId).filter(Boolean))];

    // Učitaj profile
    const profiles = {};
    await Promise.all(ownerIds.map(async uid => {
      try {
        const s = await getDoc(doc(db, 'users', uid));
        if (s.exists()) profiles[uid] = s.data();
      } catch(e) {}
    }));

    const renderUnitCard = (d) => {
      const unit = d.data;
      const unitId = d.id;
      return getPeriodTotals(unitId).then(({ income, expense }) => {
        const profit = income - expense;
        const card = document.createElement('div');
        card.className = 'unit-list-item';
        card.innerHTML = `
          <div class="unit-item-info">
            <span class="unit-item-name">${unit.name}</span>
            <span class="unit-item-sub">${unit.tenantEmail || 'bez zakupca'} · ${periodLabel()}</span>
          </div>
          <div class="unit-item-right" style="gap:2px">
            <span style="font-size:12px;color:var(--green);font-weight:600">+${fmt(income)}</span>
            <span style="font-size:12px;color:var(--red);font-weight:600">-${fmt(expense)}</span>
            <span style="font-size:13px;color:${profit>=0?'var(--accent)':'var(--red)'};font-weight:700">${profit>=0?'+':''}${fmt(profit)}</span>
            <i class="ti ti-chevron-right" style="color:var(--muted);font-size:14px;margin-top:2px"></i>
          </div>
        `;
        card.addEventListener('click', () => openFinanceUnit(unitId, unit));
        return card;
      });
    };

    const renderSection = (name, email) => {
      const section = document.createElement('div');
      section.className = 'owner-section';
      section.innerHTML = `
        <div class="owner-section-header">
          <i class="ti ti-user-circle"></i>
          <div>
            <span class="owner-section-name">${name}</span>
            <span class="owner-section-email">${email}</span>
          </div>
        </div>
      `;
      listEl.appendChild(section);
    };

    if (isMasterAdmin) {
      const myUid   = user.uid;
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

      if (myUnits.length) {
        const p = profiles[myUid] || {};
        renderSection(p.displayName || 'Master Admin', p.email || user.email);
        for (const d of myUnits) listEl.appendChild(await renderUnitCard(d));
      }
      for (const oid of ownerOrder) {
        const p = profiles[oid] || {};
        renderSection(p.displayName || '—', p.email || oid);
        for (const d of byOwner[oid]) listEl.appendChild(await renderUnitCard(d));
      }
    } else {
      // Landlord — samo njegovi stanovi, bez sekcija
      for (const d of allDocs) listEl.appendChild(await renderUnitCard(d));
    }
  } catch(e) {
    listEl.innerHTML = `<p class="info-text">Greška: ${e.message}</p>`;
    console.error(e);
  }
}
  }
}

// ── Otvori detalje stana ─────────────────────────────────────────
async function openFinanceUnit(unitId, unitData) {
  currentFinanceUnit = { id: unitId, data: unitData };
  document.getElementById('finDetailTitle').textContent = unitData.name;

  // Popuni predlog iznosa rente iz podataka stana
  if (unitData.rent) {
    document.getElementById('finIncomeAmount').value   = unitData.rent;
    document.getElementById('finIncomeCurrency').value = unitData.valuta || 'RSD';
  }

  document.getElementById('finUnitList').hidden   = true;
  document.getElementById('finUnitDetail').hidden = false;

  await refreshFinanceDetail();
}

// ── Osvježi prikaz detalja ───────────────────────────────────────
async function refreshFinanceDetail() {
  if (!currentFinanceUnit) return;
  const { id } = currentFinanceUnit;

  // Summary
  const { income, expense } = await getPeriodTotals(id);
  const profit = income - expense;
  const cur = financeDisplayCurrency;
  document.getElementById('finSummary').innerHTML = `
    <div class="fin-sum-card income">
      <i class="ti ti-trending-up"></i>
      <span>${fmt(income)}</span>
      <small>Prihod · ${periodLabel()}</small>
    </div>
    <div class="fin-sum-card expense">
      <i class="ti ti-trending-down"></i>
      <span>${fmt(expense)}</span>
      <small>Troškovi · ${periodLabel()}</small>
    </div>
    <div class="fin-sum-card profit">
      <i class="ti ti-cash"></i>
      <span style="color:${profit>=0?'var(--accent)':'var(--red)'}">${profit>=0?'+':''}${fmt(profit)}</span>
      <small>Profit · ${periodLabel()}</small>
    </div>
  `;

  // Istorija
  await loadHistory(id);
}

// ── Istorija transakcija ─────────────────────────────────────────
async function loadHistory(unitId) {
  const box = document.getElementById('finHistory');
  box.innerHTML = '<p class="info-text" style="padding:12px">Učitavam...</p>';

  const { from, to } = getPeriodRange();
  try {
    const [incSnap, expSnap] = await Promise.all([
      getDocs(query(collection(db, 'units', unitId, 'income'),   orderBy('datum', 'desc'))),
      getDocs(query(collection(db, 'units', unitId, 'expenses'), orderBy('datum', 'desc'))),
    ]);

    const items = [];
    incSnap.forEach(d => {
      const data = d.data();
      const dt = tsToDate(data.datum);
      if (dt >= from && dt <= to)
        items.push({ ...data, _id: d.id, _type: 'income', _date: dt });
    });
    expSnap.forEach(d => {
      const data = d.data();
      const dt = tsToDate(data.datum);
      if (dt >= from && dt <= to)
        items.push({ ...data, _id: d.id, _type: 'expense', _date: dt });
    });

    items.sort((a, b) => b._date - a._date);

    if (items.length === 0) {
      box.innerHTML = '<p class="info-text" style="padding:12px 16px">Nema transakcija za ovaj period.</p>';
      return;
    }

    box.innerHTML = '';
    items.forEach(item => {
      const isIncome = item._type === 'income';
      const label = isIncome
        ? (item.napomena || 'Prihod')
        : (item.napomena || typeLabel(item.vrsta));
      const amtRSD = toRSD(item.iznos, item.valuta);
      const dispAmt = toDisplay(amtRSD);

      const row = document.createElement('div');
      row.className = 'fin-history-row';
      row.innerHTML = `
        <div class="fin-history-icon ${isIncome ? 'inc' : 'exp'}">
          <i class="ti ${isIncome ? 'ti-trending-up' : 'ti-trending-down'}"></i>
        </div>
        <div class="fin-history-info">
          <span class="fin-history-label">${label}</span>
          <span class="fin-history-date">${formatDate(item._date)}</span>
        </div>
        <div class="fin-history-right">
          <span class="fin-history-amt ${isIncome ? 'inc' : 'exp'}">${isIncome?'+':'-'}${fmt(dispAmt)}</span>
          <button class="btn-delete-unit fin-del-btn" data-id="${item._id}" data-type="${item._type}">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      `;
      row.querySelector('.fin-del-btn').addEventListener('click', async e => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (!confirm('Obriši ovu transakciju?')) return;
        const col = btn.dataset.type === 'income' ? 'income' : 'expenses';
        await deleteDoc(doc(db, 'units', unitId, col, btn.dataset.id));
        await refreshFinanceDetail();
        loadFinanceUnitList();
      });
      box.appendChild(row);
    });
  } catch(e) {
    box.innerHTML = `<p class="info-text" style="padding:12px">Greška: ${e.message}</p>`;
  }
}

// ── Dodaj prihod ─────────────────────────────────────────────────
async function addIncome() {
  const iznos   = parseFloat(document.getElementById('finIncomeAmount').value);
  const valuta  = document.getElementById('finIncomeCurrency').value;
  const datum   = document.getElementById('finIncomeDate').value;
  const napomena = document.getElementById('finIncomeNote').value.trim();
  if (!iznos || !datum) { alert('Unesi iznos i datum.'); return; }
  const btn = document.getElementById('finAddIncome');
  btn.disabled = true;
  try {
    await addDoc(collection(db, 'units', currentFinanceUnit.id, 'income'), {
      iznos, valuta, datum: dateStrToTs(datum), napomena, unet: Timestamp.now()
    });
    document.getElementById('finIncomeNote').value = '';
    document.getElementById('finIncomeDate').value = todayStr();
    await refreshFinanceDetail();
    loadFinanceUnitList();
  } catch(e) { alert('Greška: ' + e.message); }
  btn.disabled = false;
}

// ── Dodaj fiksni trošak ──────────────────────────────────────────
async function addFixedExpense() {
  const vrsta  = document.getElementById('finFixedType').value;
  const iznos  = parseFloat(document.getElementById('finFixedAmount').value);
  const valuta = document.getElementById('finFixedCurrency').value;
  const datum  = document.getElementById('finFixedDate').value;
  const napomena = document.getElementById('finFixedNote').value.trim();
  if (!iznos || !datum) { alert('Unesi iznos i datum.'); return; }
  const btn = document.getElementById('finAddFixed');
  btn.disabled = true;
  try {
    await addDoc(collection(db, 'units', currentFinanceUnit.id, 'expenses'), {
      vrsta, iznos, valuta, datum: dateStrToTs(datum),
      kategorija: 'fiksni', napomena, unet: Timestamp.now()
    });
    document.getElementById('finFixedAmount').value = '';
    document.getElementById('finFixedNote').value   = '';
    document.getElementById('finFixedDate').value   = todayStr();
    await refreshFinanceDetail();
    loadFinanceUnitList();
  } catch(e) { alert('Greška: ' + e.message); }
  btn.disabled = false;
}

// ── Dodaj varijabilni trošak ─────────────────────────────────────
async function addVarExpense() {
  const vrsta   = document.getElementById('finVarType').value;
  const iznos   = parseFloat(document.getElementById('finVarAmount').value);
  const valuta  = document.getElementById('finVarCurrency').value;
  const datum   = document.getElementById('finVarDate').value;
  const napomena = document.getElementById('finVarNote').value.trim();
  if (!iznos || !datum) { alert('Unesi iznos i datum.'); return; }
  const btn = document.getElementById('finAddVar');
  btn.disabled = true;
  try {
    await addDoc(collection(db, 'units', currentFinanceUnit.id, 'expenses'), {
      vrsta, iznos, valuta, datum: dateStrToTs(datum),
      kategorija: 'varijabilni', napomena, unet: Timestamp.now()
    });
    document.getElementById('finVarAmount').value = '';
    document.getElementById('finVarNote').value   = '';
    document.getElementById('finVarDate').value   = todayStr();
    await refreshFinanceDetail();
    loadFinanceUnitList();
  } catch(e) { alert('Greška: ' + e.message); }
  btn.disabled = false;
}

// ── Totali za period ─────────────────────────────────────────────
async function getPeriodTotals(unitId) {
  const { from, to } = getPeriodRange();
  let income = 0, expense = 0;
  try {
    const [incSnap, expSnap] = await Promise.all([
      getDocs(query(collection(db, 'units', unitId, 'income'),   orderBy('datum', 'asc'))),
      getDocs(query(collection(db, 'units', unitId, 'expenses'), orderBy('datum', 'asc'))),
    ]);
    incSnap.forEach(d => {
      const data = d.data();
      const dt = tsToDate(data.datum);
      if (dt >= from && dt <= to) income += toDisplay(toRSD(data.iznos, data.valuta));
    });
    expSnap.forEach(d => {
      const data = d.data();
      const dt = tsToDate(data.datum);
      if (dt >= from && dt <= to) expense += toDisplay(toRSD(data.iznos, data.valuta));
    });
  } catch(e) { /* tišina */ }
  return { income, expense };
}

// ── Export: vrati na listu finansija ────────────────────────────
export function showFinanceList() {
  if (!currentFinanceUnit) return; // već na listi
  currentFinanceUnit = null;
  document.getElementById('finUnitList').hidden   = false;
  document.getElementById('finUnitDetail').hidden = true;
  loadFinanceUnitList();
}

// ── Export za dashboard ──────────────────────────────────────────
export async function getDashboardTotals(ownerId = null) {
  // Učitaj settings ako finance modul još nije inicijalizovan
  try {
    const settSnap = await getDoc(doc(db, 'settings', 'finance'));
    if (settSnap.exists()) {
      const sd = settSnap.data();
      if (sd.exchangeRate)    financeExchangeRate    = sd.exchangeRate;
      if (sd.displayCurrency) financeDisplayCurrency = sd.displayCurrency;
    }
  } catch(e) { /* tišina */ }

  const saved = financePeriod;
  financePeriod = 'month';
  let totalIncome = 0, totalExpense = 0;
  try {
    // Ako je prosleđen ownerId (landlord), filtriraj samo njegove stanove
    const unitsQuery = ownerId
      ? query(collection(db, 'units'), where('ownerId', '==', ownerId))
      : collection(db, 'units');
    const snap = await getDocs(unitsQuery);
    for (const d of snap.docs) {
      const { income, expense } = await getPeriodTotals(d.id);
      totalIncome  += income;
      totalExpense += expense;
    }
  } catch(e) { /* tišina */ }
  financePeriod = saved;
  return {
    income:   totalIncome,
    expense:  totalExpense,
    profit:   totalIncome - totalExpense,
    currency: financeDisplayCurrency
  };
}

// ── Helpers ──────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function dateStrToTs(str) {
  return Timestamp.fromDate(new Date(str + 'T12:00:00'));
}
function tsToDate(ts) {
  if (!ts) return new Date(0);
  if (ts.toDate) return ts.toDate();
  return new Date(ts);
}
function formatDate(d) {
  return d.toLocaleDateString('sr-Latn', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function toRSD(iznos, valuta) {
  return valuta === 'EUR' ? iznos * financeExchangeRate : iznos;
}
function toDisplay(rsd) {
  return financeDisplayCurrency === 'EUR' ? rsd / financeExchangeRate : rsd;
}
function fmt(val) {
  return val.toLocaleString('sr-Latn', { maximumFractionDigits: 2 }) + ' ' + financeDisplayCurrency;
}
function periodLabel() {
  return PERIODS.find(p => p.id === financePeriod)?.label || '';
}
function typeLabel(vrsta) {
  const all = [...FIXED_EXPENSE_TYPES, ...VAR_EXPENSE_TYPES];
  return all.find(t => t.id === vrsta)?.label || vrsta || 'Trošak';
}
function getPeriodRange() {
  const now = new Date();
  let from, to;
  if (financePeriod === 'day') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    to   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (financePeriod === 'week') {
    const day = now.getDay() || 7; // ponedeljak = 1
    from = new Date(now); from.setDate(now.getDate() - day + 1); from.setHours(0,0,0,0);
    to   = new Date(from); to.setDate(from.getDate() + 6); to.setHours(23,59,59,999);
  } else if (financePeriod === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else { // year
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }
  return { from, to };
}
