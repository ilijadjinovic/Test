// ── Config ──────────────────────────────────────────────
// Add email addresses of admin users here
const ADMIN_EMAILS = [
  'ilija.djinovic@gmail.com', 'akialexdj@gmail.com'
  // 'ilija.djinovic@gmail.com',
];

// ── State ────────────────────────────────────────────────
let currentUser = null;

// ── Tab switching ────────────────────────────────────────
window.switchTab = function (name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  btn.classList.add('active');

  if (name === 'admin') renderAdmin();
};

// ── Admin guard ──────────────────────────────────────────
function renderAdmin() {
  const isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
  document.getElementById('admin-content').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('admin-locked').style.display  = isAdmin ? 'none'  : 'block';
}

// ── Leaderboard ──────────────────────────────────────────
function renderLeaderboard(entries) {
  const list = document.getElementById('leaderboardList');
  const rankClasses = ['gold', 'silver', 'bronze'];
  const avatarClasses = ['av-blue', 'av-teal', 'av-purple', 'av-red'];

  list.innerHTML = entries.map((e, i) => {
    // e.name treba da bude nadimak igrača (nickname iz Firestore/localStorage)
    const displayName = e.name;
    const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const rankClass = rankClasses[i] || '';
    const avClass = avatarClasses[i % avatarClasses.length];
    return `
      <li class="leaderboard-item">
        <span class="rank ${rankClass}">${i + 1}</span>
        <div class="avatar ${avClass}">${initials}</div>
        <span class="lb-name">${displayName}</span>
        <span class="lb-score">${e.score}<span class="lb-pts">pt</span></span>
      </li>`;
  }).join('');
}

// ── Nickname ─────────────────────────────────────────────
window.saveNickname = function () {
  const input = document.getElementById('nicknameInput');
  const hint  = document.getElementById('nicknameHint');
  const nick  = input.value.trim();

  if (!currentUser) {
    hint.style.color = '#e85050';
    hint.textContent = 'Mora biti prijavljen.';
    return;
  }
  if (!nick) {
    hint.style.color = '#e85050';
    hint.textContent = 'Nadimak ne sme biti prazan.';
    return;
  }

  // Sačuvaj u localStorage (zameni Firestore setDoc kad povežeš Firebase)
  localStorage.setItem('nickname_' + currentUser.uid, nick);

  hint.style.color = '#2da87a';
  hint.textContent = 'Nadimak sačuvan ✓';

  // Ažuriraj prikaz u profilu ako je prikazano ime
  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = nick;
};

window.onNicknameInput = function () {
  document.getElementById('nicknameHint').textContent = '';
};

function loadNickname(user) {
  if (!user) return;
  const saved = localStorage.getItem('nickname_' + user.uid);
  document.getElementById('nicknameInput').value = saved || '';
}

// Helper: vrati nadimak korisnika ili fallback
function getDisplayName(user) {
  if (!user) return 'Igrač';
  const saved = localStorage.getItem('nickname_' + user.uid);
  return saved || user.displayName || user.email.split('@')[0];
}

// ── Profile ──────────────────────────────────────────────
function renderProfile(user) {
  const card = document.getElementById('profileCard');
  if (user) {
    card.style.display = 'flex';
    const displayName = getDisplayName(user);
    const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('profileName').textContent   = displayName;
    document.getElementById('profileEmail').textContent  = user.email;
    document.getElementById('loginBtn').textContent      = 'Odjavi se';
    loadNickname(user);
  } else {
    card.style.display = 'none';
    document.getElementById('nicknameInput').value = '';
    document.getElementById('nicknameHint').textContent = '';
    document.getElementById('loginBtn').innerHTML = `
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
        <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
      </svg>
      Prijavi se Google nalogom`;
  }
}

// ── Auth ─────────────────────────────────────────────────
// Replace this block with your Firebase Auth logic
window.handleLogin = async function () {
  if (currentUser) {
    // sign out
    currentUser = null;
    renderProfile(null);
    renderAdmin();
  } else {
    // TODO: replace with Firebase Google sign-in
    // import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
    // const provider = new GoogleAuthProvider();
    // const result = await signInWithPopup(auth, provider);
    // currentUser = result.user;
    alert('Ovde poveži Firebase Auth');
  }
};

// ── Quiz ─────────────────────────────────────────────────
window.createRoom = function () {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  document.getElementById('roomInfo').textContent = `Kod sobe: ${code}`;
};

window.joinRoom = function () {
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!code) return;
  document.getElementById('roomInfo').textContent = `Priključuješ se sobi: ${code}`;
};

// ── Admin actions ────────────────────────────────────────
window.adminClearRooms       = () => confirm('Obriši sve sobe?')       && alert('Sobe obrisane.');
window.adminResetLeaderboard = () => confirm('Resetuj tabelu rezultata?') && alert('Tabela resetovana.');
window.adminAddQuestions     = () => alert('Ovde otvori modal za dodavanje pitanja.');

// ── Init ─────────────────────────────────────────────────
// Demo leaderboard data — replace with Firestore fetch
renderLeaderboard([
  { name: 'Aleksa A.', score: 4820 },
  { name: 'Milica J.', score: 3990 },
  { name: 'Nikola P.', score: 3640 },
  { name: 'Stefan R.', score: 2810 },
]);

renderProfile(null);
