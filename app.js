import { auth, db, GoogleAuthProvider, signInWithPopup,
         signOut, onAuthStateChanged, doc, getDoc, setDoc,
         collection, getDocs, addDoc, deleteDoc, query, orderBy,
         updateDoc, serverTimestamp, limit }
  from './firebase.js';

import { initialQuestions } from './questions.js';

// ── Config ───────────────────────────────────────────────
const ADMIN_EMAILS = ['ilija.djinovic@gmail.com', 'akialexdj@gmail.com'];
const MAX_PLAYERS  = 4;
const QUESTIONS_PER_QUIZ = 12;
const SUBJECTS = ['Matematika', 'Srpski jezik', 'Priroda i društvo', 'Nemački jezik'];

// ── State ────────────────────────────────────────────────
let currentUser     = null;
let allQuestions    = [];
let currentRoomId   = null;
let isRoomCreator   = false;
let roomPollTimer   = null;
let quizQuestions   = [];
let currentQIndex   = 0;
let quizScore       = 0;
let quizAnswered    = false;
let countdownTimer  = null;
let pollInterval    = null;

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
  if (isAdmin) loadAdminQuestions();
}

// ── Leaderboard ──────────────────────────────────────────
async function loadLeaderboard() {
  const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(5));
  const snap = await getDocs(q);
  const entries = snap.docs.map(d => d.data());
  renderLeaderboard(entries);
}

function renderLeaderboard(entries) {
  const list = document.getElementById('leaderboardList');
  if (!entries.length) {
    list.innerHTML = '<li style="color:#3c4060;font-size:13px;padding:12px 0;list-style:none;">Još nema rezultata.</li>';
    return;
  }
  const rankClasses  = ['gold', 'silver', 'bronze'];
  const avatarClasses = ['av-blue', 'av-teal', 'av-purple', 'av-red'];
  list.innerHTML = entries.map((e, i) => {
    const displayName = e.name || 'Igrač';
    const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `
      <li class="leaderboard-item">
        <span class="rank ${rankClasses[i] || ''}">${i + 1}</span>
        <div class="avatar ${avatarClasses[i % avatarClasses.length]}">${initials}</div>
        <span class="lb-name">${displayName}</span>
        <span class="lb-score">${e.score}<span class="lb-pts">pt</span></span>
      </li>`;
  }).join('');
}

// ── Nickname ─────────────────────────────────────────────
window.saveNickname = async function () {
  const input = document.getElementById('nicknameInput');
  const hint  = document.getElementById('nicknameHint');
  const nick  = input.value.trim();
  if (!currentUser) { hint.style.color = '#e85050'; hint.textContent = 'Mora biti prijavljen.'; return; }
  if (!nick)        { hint.style.color = '#e85050'; hint.textContent = 'Nadimak ne sme biti prazan.'; return; }
  await setDoc(doc(db, 'users', currentUser.uid), { nickname: nick }, { merge: true });
  hint.style.color = '#2da87a';
  hint.textContent = 'Nadimak sačuvan ✓';
  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = nick;
};

window.onNicknameInput = function () {
  document.getElementById('nicknameHint').textContent = '';
};

async function getMyNickname() {
  if (!currentUser) return 'Igrač';
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  if (snap.exists()) return snap.data().nickname || currentUser.displayName || currentUser.email.split('@')[0];
  return currentUser.displayName || currentUser.email.split('@')[0];
}

function getDisplayName(user, firestoreNick) {
  if (!user) return 'Igrač';
  return firestoreNick || user.displayName || user.email.split('@')[0];
}

// ── Profile ──────────────────────────────────────────────
function renderProfile(user, nickname) {
  const card = document.getElementById('profileCard');
  if (user) {
    card.style.display = 'flex';
    const displayName = getDisplayName(user, nickname);
    const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('profileName').textContent   = displayName;
    document.getElementById('profileEmail').textContent  = user.email;
    document.getElementById('loginBtn').textContent      = 'Odjavi se';
    if (nickname) document.getElementById('nicknameInput').value = nickname;
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
window.handleLogin = async function () {
  if (currentUser) { await signOut(auth); }
  else { await signInWithPopup(auth, new GoogleAuthProvider()); }
};

// ══════════════════════════════════════════════════════════
// ── QUIZ / ROOM LOGIC ────────────────────────────────────
// ══════════════════════════════════════════════════════════

function resetQuizUI() {
  document.getElementById('roomInfo').innerHTML    = '';
  document.getElementById('countdown').innerHTML   = '';
  document.getElementById('questionArea').innerHTML = '';
  // show lobby cards again
  document.querySelector('#panel-quiz .room-card').style.display      = '';
  document.querySelectorAll('#panel-quiz .room-card')[1].style.display = '';
}

function showLobby(roomId, code, players, amCreator) {
  // hide join/create cards
  document.querySelectorAll('#panel-quiz .room-card').forEach(c => c.style.display = 'none');

  const canStart = amCreator && players.length >= 2;

  document.getElementById('roomInfo').innerHTML = `
    <div class="room-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#3c4060;font-weight:500;">Kod sobe</p>
        <span style="font-family:'DM Mono',monospace;font-size:20px;font-weight:700;color:#e8eaf0;letter-spacing:4px;">${code}</span>
      </div>
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#3c4060;font-weight:500;margin-bottom:10px;">
        Čekam takmičare… (${players.length}/${MAX_PLAYERS})
      </p>
      <ul id="lobbyPlayerList" style="list-style:none;padding:0;margin:0 0 14px;display:flex;flex-direction:column;gap:8px;">
        ${players.map((p, i) => `
          <li style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1a1d2e;border-radius:10px;border:0.5px solid #2a2d40;">
            <span style="width:24px;height:24px;border-radius:50%;background:#252840;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#7b82a8;">${i+1}</span>
            <span style="font-size:14px;color:#c8ccd8;font-weight:${i===0?'700':'400'};">${p.name}${i===0?' 👑':''}</span>
          </li>`).join('')}
      </ul>
      ${amCreator ? `
        <button class="btn-primary" style="width:100%;${!canStart?'opacity:0.4;cursor:not-allowed;':''}"
          onclick="startQuiz()" ${!canStart?'disabled':''} id="startQuizBtn">
          ${canStart ? 'Pokreni kviz →' : 'Čekam još igrača…'}
        </button>
        <button class="btn-secondary" style="width:100%;margin-top:8px;" onclick="leaveRoom()">Napusti sobu</button>
      ` : `
        <p style="font-size:13px;color:#5a5f75;text-align:center;">Čekam da kreator pokrene kviz…</p>
        <button class="btn-secondary" style="width:100%;margin-top:8px;" onclick="leaveRoom()">Napusti sobu</button>
      `}
    </div>`;
}

// Generate 12 questions: 3 per subject
function pickQuestions(allQ) {
  const result = [];
  SUBJECTS.forEach(subj => {
    const pool = allQ.filter(q => q.subject === subj);
    const shuffled = pool.sort(() => Math.random() - 0.5);
    result.push(...shuffled.slice(0, 3));
  });
  return result.sort(() => Math.random() - 0.5);
}

// ── Create room ──────────────────────────────────────────
window.createRoom = async function () {
  if (!currentUser) { alert('Prijavite se da biste kreirali sobu.'); return; }
  const nick = await getMyNickname();
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();

  const roomRef = await addDoc(collection(db, 'rooms'), {
    code,
    creatorUid: currentUser.uid,
    status: 'waiting',
    createdAt: serverTimestamp(),
    players: [{ uid: currentUser.uid, name: nick, score: 0 }],
    questions: [],
    currentQuestion: -1,
  });

  currentRoomId  = roomRef.id;
  isRoomCreator  = true;
  showLobby(roomRef.id, code, [{ uid: currentUser.uid, name: nick }], true);
  startRoomPolling();
};

// ── Join room ────────────────────────────────────────────
window.joinRoom = async function () {
  if (!currentUser) { alert('Prijavite se da biste se pridružili sobi.'); return; }
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!code) return;

  const q = query(collection(db, 'rooms'));
  const snap = await getDocs(q);
  let roomDoc = null;
  snap.forEach(d => { if (d.data().code === code) roomDoc = d; });

  if (!roomDoc) { alert('Soba nije pronađena.'); return; }

  const room = roomDoc.data();
  if (room.status !== 'waiting') { alert('Kviz je već počeo ili je završen.'); return; }
  if (room.players.length >= MAX_PLAYERS) { alert('Soba je puna (max 4 igrača).'); return; }

  // check if already in room
  const alreadyIn = room.players.find(p => p.uid === currentUser.uid);
  if (!alreadyIn) {
    const nick = await getMyNickname();
    const newPlayers = [...room.players, { uid: currentUser.uid, name: nick, score: 0 }];
    await updateDoc(doc(db, 'rooms', roomDoc.id), { players: newPlayers });
  }

  currentRoomId = roomDoc.id;
  isRoomCreator = false;
  const updSnap = await getDoc(doc(db, 'rooms', roomDoc.id));
  const players = updSnap.data().players;
  showLobby(roomDoc.id, code, players, false);
  startRoomPolling();
};

// ── Leave room ───────────────────────────────────────────
window.leaveRoom = async function () {
  stopPolling();
  if (currentRoomId && currentUser) {
    const roomSnap = await getDoc(doc(db, 'rooms', currentRoomId));
    if (roomSnap.exists()) {
      const room = roomSnap.data();
      const newPlayers = room.players.filter(p => p.uid !== currentUser.uid);
      if (newPlayers.length === 0 || room.creatorUid === currentUser.uid) {
        await deleteDoc(doc(db, 'rooms', currentRoomId));
      } else {
        await updateDoc(doc(db, 'rooms', currentRoomId), { players: newPlayers });
      }
    }
  }
  currentRoomId = null;
  isRoomCreator = false;
  resetQuizUI();
};

// ── Polling ──────────────────────────────────────────────
function startRoomPolling() {
  stopPolling();
  pollInterval = setInterval(pollRoom, 2000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function pollRoom() {
  if (!currentRoomId) return;
  const roomSnap = await getDoc(doc(db, 'rooms', currentRoomId));
  if (!roomSnap.exists()) { stopPolling(); resetQuizUI(); return; }

  const room = roomSnap.data();

  if (room.status === 'waiting') {
    showLobby(currentRoomId, room.code, room.players, isRoomCreator);
  } else if (room.status === 'playing') {
    stopPolling();
    quizQuestions = room.questions || [];
    if (quizQuestions.length === 0) {
      console.error('pollRoom: quizQuestions je prazan!');
      return;
    }
    beginQuiz();
  }
}

// ── Start quiz (creator only) ────────────────────────────
window.startQuiz = async function () {
  if (!isRoomCreator || !currentRoomId) return;

  // Load all questions from Firestore
  const snap = await getDocs(collection(db, 'questions'));
  const allQ = snap.docs.map(d => d.data());
  const picked = pickQuestions(allQ);

  await updateDoc(doc(db, 'rooms', currentRoomId), {
    status: 'playing',
    questions: picked,
    currentQuestion: 0,
  });

  // Kreator odmah startuje lokalno, ne čeka polling
  stopPolling();
  quizQuestions = picked;
  beginQuiz();
};

// ── Begin quiz locally ───────────────────────────────────
function beginQuiz() {
  currentQIndex = 0;
  quizScore     = 0;

  // hide lobby
  document.getElementById('roomInfo').innerHTML = '';
  document.getElementById('countdown').innerHTML = '';
  document.getElementById('questionArea').innerHTML = '';

  startCountdown(5, () => showQuestion());
}

function startCountdown(from, cb) {
  let n = from;
  document.getElementById('countdown').innerHTML = `
    <div style="text-align:center;padding:40px 0;">
      <p style="font-size:13px;color:#5a5f75;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">Kviz počinje za</p>
      <div id="countdownNum" style="font-size:72px;font-weight:900;color:#e8eaf0;font-family:'Syne',sans-serif;line-height:1;">${n}</div>
    </div>`;

  countdownTimer = setInterval(() => {
    n--;
    const el = document.getElementById('countdownNum');
    if (el) el.textContent = n;
    if (n <= 0) {
      clearInterval(countdownTimer);
      document.getElementById('countdown').innerHTML = '';
      cb();
    }
  }, 1000);
}

let questionTimer = null;
const QUESTION_TIME = 10; // sekundi po pitanju

function showQuestion() {
  if (currentQIndex >= quizQuestions.length) { endQuiz(); return; }

  if (questionTimer) { clearInterval(questionTimer); questionTimer = null; }

  const q = quizQuestions[currentQIndex];
  quizAnswered = false;

  document.getElementById('questionArea').innerHTML = `
    <div class="room-card" style="margin-bottom:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span class="tag tag-blue">${q.subject}</span>
        <span style="font-size:12px;color:#5a5f75;">${currentQIndex + 1} / ${quizQuestions.length}</span>
      </div>
      <div style="height:4px;background:#1a1d2e;border-radius:2px;margin-bottom:12px;">
        <div style="height:4px;background:#4f6bff;border-radius:2px;width:${((currentQIndex+1)/quizQuestions.length)*100}%;"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div id="questionTimerBar" style="flex:1;height:6px;background:#1a1d2e;border-radius:3px;overflow:hidden;">
          <div id="questionTimerFill" style="height:100%;background:#4f6bff;border-radius:3px;width:100%;"></div>
        </div>
        <span id="questionTimerDisplay" style="font-size:14px;font-weight:700;color:#4f6bff;min-width:28px;text-align:right;">${QUESTION_TIME}</span>
      </div>
      <p style="font-size:16px;font-weight:600;color:#e8eaf0;line-height:1.5;margin:16px 0 20px;">${q.question}</p>
      <div style="display:flex;flex-direction:column;gap:10px;" id="answerBtns">
        ${q.options.map((opt, i) => `
          <button onclick="answerQuestion(${i})" data-idx="${i}"
            style="width:100%;text-align:left;padding:12px 16px;border-radius:12px;
              background:#1a1d2e;border:0.5px solid #2a2d40;color:#c8ccd8;
              font-size:14px;cursor:pointer;transition:background .15s;"
            onmouseover="this.style.background='#252840'" onmouseout="this.style.background='#1a1d2e'">
            <span style="font-weight:700;color:#4f6bff;margin-right:8px;">${String.fromCharCode(65+i)}.</span>${opt}
          </button>`).join('')}
      </div>
    </div>`;

  // Ticker koji odbrojava sekunde
  let timeLeft = QUESTION_TIME;
  const totalTime = QUESTION_TIME;

  questionTimer = setInterval(() => {
    timeLeft--;

    const timerEl = document.getElementById('questionTimerDisplay');
    const fillEl  = document.getElementById('questionTimerFill');

    if (timerEl) timerEl.textContent = timeLeft;
    if (fillEl)  fillEl.style.width  = ((timeLeft / totalTime) * 100) + '%';

    // Promeni boju kad ostane malo vremena
    if (timeLeft <= 3) {
      if (timerEl) timerEl.style.color = '#e85050';
      if (fillEl)  fillEl.style.background = '#e85050';
    }

    if (timeLeft <= 0) {
      clearInterval(questionTimer);
      questionTimer = null;
      if (!quizAnswered) {
        quizAnswered = true;
        const btns = document.querySelectorAll('#answerBtns button');
        btns.forEach((btn, i) => {
          btn.disabled = true;
          btn.onmouseover = null;
          btn.onmouseout  = null;
          if (i === q.answer) {
            btn.style.background = '#0f2e27';
            btn.style.border     = '0.5px solid #2da87a';
            btn.style.color      = '#2da87a';
          }
        });
        setTimeout(() => { currentQIndex++; showQuestion(); }, 1200);
      }
    }
  }, 1000);
}

window.answerQuestion = function (chosenIdx) {
  if (quizAnswered) return;
  quizAnswered = true;

  if (questionTimer) { clearInterval(questionTimer); questionTimer = null; }

  const q = quizQuestions[currentQIndex];
  const correct = chosenIdx === q.answer;
  if (correct) quizScore += 5;

  // color buttons
  const btns = document.querySelectorAll('#answerBtns button');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    btn.onmouseover = null;
    btn.onmouseout  = null;
    if (i === q.answer) {
      btn.style.background = '#0f2e27';
      btn.style.border     = '0.5px solid #2da87a';
      btn.style.color      = '#2da87a';
    } else if (i === chosenIdx && !correct) {
      btn.style.background = '#2e0f0f';
      btn.style.border     = '0.5px solid #e85050';
      btn.style.color      = '#e85050';
    }
  });

  setTimeout(() => {
    currentQIndex++;
    showQuestion();
  }, 1200);
};

// ── End quiz ─────────────────────────────────────────────
async function endQuiz() {
  stopPolling();

  // Save score to room
  if (currentRoomId && currentUser) {
    const roomSnap = await getDoc(doc(db, 'rooms', currentRoomId));
    if (roomSnap.exists()) {
      const room = roomSnap.data();
      const updPlayers = room.players.map(p =>
        p.uid === currentUser.uid ? { ...p, score: quizScore } : p
      );
      await updateDoc(doc(db, 'rooms', currentRoomId), {
        players: updPlayers,
        status: 'finished',
      });
      // Obriši sobu nakon 30s da ne smeta novim igrama
      setTimeout(async () => {
        try { await deleteDoc(doc(db, 'rooms', currentRoomId)); } catch(e) {}
      }, 30000);

      // Update global leaderboard
      await updateGlobalLeaderboard(currentUser.uid, quizScore);

      // Show results using room players
      const finalSnap = await getDoc(doc(db, 'rooms', currentRoomId));
      const finalPlayers = finalSnap.data().players;
      showResults(finalPlayers);
    }
  } else {
    showResults([]);
  }
}

async function updateGlobalLeaderboard(uid, score) {
  const nick = await getMyNickname();
  const lbRef = doc(db, 'leaderboard', uid);
  const lbSnap = await getDoc(lbRef);
  const existing = lbSnap.exists() ? lbSnap.data().score : 0;
  await setDoc(lbRef, { uid, name: nick, score: existing + score }, { merge: false });
}

function showResults(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const myResult = players.find(p => p.uid === currentUser?.uid);

  document.getElementById('questionArea').innerHTML = `
    <div class="room-card" style="text-align:center;margin-bottom:12px;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#3c4060;font-weight:500;margin-bottom:8px;">Tvoj rezultat</p>
      <div style="font-size:52px;font-weight:900;color:#e8eaf0;font-family:'Syne',sans-serif;line-height:1;">${myResult?.score ?? quizScore}</div>
      <div style="font-size:13px;color:#5a5f75;margin-top:4px;">poena</div>
    </div>
    <div class="room-card">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#3c4060;font-weight:500;margin-bottom:12px;">Rang lista takmičenja</p>
      ${sorted.map((p, i) => {
        const medals = ['🥇','🥈','🥉'];
        const isMe = p.uid === currentUser?.uid;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            background:${isMe?'#1a2040':'#1a1d2e'};border-radius:10px;
            border:0.5px solid ${isMe?'#4f6bff':'#2a2d40'};margin-bottom:8px;">
            <span style="font-size:18px;width:28px;">${medals[i]||i+1}</span>
            <span style="flex:1;font-size:14px;color:${isMe?'#a0aaff':'#c8ccd8'};font-weight:${isMe?700:400};">
              ${p.name}${isMe?' (ti)':''}
            </span>
            <span style="font-size:15px;font-weight:700;color:#e8eaf0;">${p.score} <span style="font-size:11px;color:#5a5f75;">pt</span></span>
          </div>`;
      }).join('')}
      <button class="btn-primary" style="width:100%;margin-top:8px;" onclick="playAgain()">Nova igra</button>
    </div>`;

  // Refresh global leaderboard
  loadLeaderboard();
}

window.playAgain = async function () {
  stopPolling();
  // Obriši staru sobu iz Firestore-a
  if (currentRoomId) {
    try { await deleteDoc(doc(db, 'rooms', currentRoomId)); } catch(e) {}
  }
  currentRoomId = null;
  isRoomCreator = false;
  resetQuizUI();
};

// ══════════════════════════════════════════════════════════
// ── ADMIN ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════

window.adminClearRooms = async function () {
  if (!confirm('Obriši sve sobe?')) return;
  const snap = await getDocs(collection(db, 'rooms'));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  alert('Sobe obrisane.');
};

window.adminResetLeaderboard = async function () {
  if (!confirm('Resetuj tabelu rezultata?')) return;
  const snap = await getDocs(collection(db, 'leaderboard'));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  renderLeaderboard([]);
  alert('Tabela resetovana.');
};

async function loadAdminQuestions() {
  const q = query(collection(db, 'questions'), orderBy('subject'));
  const snap = await getDocs(q);
  allQuestions = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  renderQuestionList();
  updateQuestionCount();
}

function updateQuestionCount() {
  const el = document.getElementById('adminQuestionCount');
  if (el) el.textContent = allQuestions.length;
}

function renderQuestionList() {
  const container = document.getElementById('adminQuestionList');
  if (!container) return;
  const filterSubject = document.getElementById('adminSubjectFilter')?.value || '';
  const filterText    = document.getElementById('adminSearchFilter')?.value.toLowerCase() || '';
  const filtered = allQuestions.filter(q => {
    const matchSubject = !filterSubject || q.subject === filterSubject;
    const matchText    = !filterText    || q.question.toLowerCase().includes(filterText);
    return matchSubject && matchText;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:#3c4060;font-size:13px;padding:12px 0;">Nema pitanja.</p>';
    return;
  }
  container.innerHTML = filtered.map(q => `
    <div class="admin-row" style="flex-direction:column;align-items:flex-start;gap:6px;">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start;gap:8px;">
        <div>
          <span class="tag tag-blue" style="margin-bottom:4px;">${q.subject}</span>
          <p style="font-size:13px;color:#c8ccd8;margin-top:4px;line-height:1.4;">${q.question}</p>
        </div>
        <button class="admin-action-btn danger" onclick="deleteQuestion('${q.firestoreId}')" style="flex-shrink:0;">
          <i class="ti ti-trash"></i>
        </button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${q.options.map((opt, i) => `
          <span style="font-size:11px;padding:2px 8px;border-radius:4px;
            background:${i === q.answer ? '#0f2e27' : '#13161f'};
            color:${i === q.answer ? '#2da87a' : '#3c4060'};
            border:0.5px solid ${i === q.answer ? '#1a4a3a' : '#1e2130'};">
            ${String.fromCharCode(65+i)}. ${opt}
          </span>`).join('')}
      </div>
    </div>`).join('');
}

window.deleteQuestion = async function (firestoreId) {
  if (!confirm('Obriši ovo pitanje?')) return;
  await deleteDoc(doc(db, 'questions', firestoreId));
  allQuestions = allQuestions.filter(q => q.firestoreId !== firestoreId);
  renderQuestionList();
  updateQuestionCount();
};

window.adminFilterQuestions = function () { renderQuestionList(); };

window.adminAddQuestions = function () {
  const modal = document.getElementById('addQuestionModal');
  if (modal) modal.style.display = 'flex';
};

window.closeAddQuestion = function () {
  const modal = document.getElementById('addQuestionModal');
  if (modal) modal.style.display = 'none';
  ['aqQuestion','aqA','aqB','aqC','aqD'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('aqAnswer').value  = '0';
  document.getElementById('aqSubject').value = SUBJECTS[0];
};

window.submitAddQuestion = async function () {
  const question = document.getElementById('aqQuestion').value.trim();
  const options  = ['aqA','aqB','aqC','aqD'].map(id => document.getElementById(id).value.trim());
  const answer   = parseInt(document.getElementById('aqAnswer').value);
  const subject  = document.getElementById('aqSubject').value;
  if (!question || options.some(o => !o)) { alert('Popuni sva polja.'); return; }
  const newQ = { subject, question, options, answer };
  const ref = await addDoc(collection(db, 'questions'), newQ);
  allQuestions.push({ firestoreId: ref.id, ...newQ });
  renderQuestionList();
  updateQuestionCount();
  closeAddQuestion();
};

// ── Seed ────────────────────────────────────────────────
async function seedQuestionsIfEmpty() {
  const snap = await getDocs(collection(db, 'questions'));
  if (!snap.empty) return;
  await Promise.all(initialQuestions.map(q => {
    const { id, ...data } = q;
    return addDoc(collection(db, 'questions'), data);
  }));
}

// ── Init ─────────────────────────────────────────────────
renderLeaderboard([]);
loadLeaderboard();
renderProfile(null);
renderAdmin();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  renderAdmin();
  if (user) {
    const ref  = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    let nickname = '';
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid, email: user.email, displayName: user.displayName,
        createdAt: new Date().toISOString(), nickname: '',
        stats: { quizzes: 0, correct: 0, points: 0 }
      });
    } else {
      nickname = snap.data().nickname || '';
    }
    renderProfile(user, nickname);
    await seedQuestionsIfEmpty();
  } else {
    renderProfile(null);
  }
});
