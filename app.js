import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// 🔧 Firebase config (unesi svoje podatke)
const firebaseConfig = {
  apiKey: "TVOJ_API_KEY",
  authDomain: "TVOJ_PROJEKAT.firebaseapp.com",
  databaseURL: "https://TVOJ_PROJEKAT.firebaseio.com",
  projectId: "TVOJ_PROJEKAT",
  storageBucket: "TVOJ_PROJEKAT.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let user = null;
let room = null;
let currentRound = 1;

// Tabs
function showTab(tabId) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.add("hidden"));
  document.getElementById(tabId).classList.remove("hidden");
}
window.showTab = showTab;

// Login
document.getElementById("loginBtn").onclick = async () => {
  const result = await signInWithPopup(auth, provider);
  user = result.user;
  document.getElementById("userInfo").textContent = "Prijavljen: " + user.displayName;
};

// Kreiranje sobe
function createRoom() {
  let code = Math.random().toString(36).substring(2,6).toUpperCase();
  room = code;
  set(ref(db, "rooms/" + room), { status: "waiting", players: {} });
  document.getElementById("roomInfo").textContent = "Tvoja soba: " + room;
}
window.createRoom = createRoom;

// Pridruživanje sobi
function joinRoom() {
  let code = document.getElementById("roomCode").value;
  room = code;
  update(ref(db, "rooms/" + room + "/players/" + user.uid), { name: user.displayName, score: 0 });
  document.getElementById("roomInfo").textContent = "Pridružen sobi: " + room;
  listenScores();
}
window.joinRoom = joinRoom;

// Countdown
function startCountdown() {
  let count = 5;
  let div = document.getElementById("countdown");
  let interval = setInterval(() => {
    div.textContent = count;
    count--;
    if (count < 0) {
      clearInterval(interval);
      startRound();
    }
  }, 1000);
}

// Start runde
function startRound() {
  document.getElementById("questionArea").innerHTML = "";
  // Demo pitanje
  let q = {
    text: "Koliko je 5 + 3?",
    options: ["A: 6", "B: 7", "C: 8", "D: 9"],
    correct: "C"
  };
  let div = document.getElementById("questionArea");
  div.innerHTML = `<p>${q.text}</p>`;
  q.options.forEach(opt => {
    let btn = document.createElement("button");
    btn.textContent = opt;
    btn.onclick = () => submitAnswer(q, opt[0]);
    div.appendChild(btn);
  });
}

// Odgovor
function submitAnswer(q, answer) {
  let points = (answer === q.correct) ? 5 : 0;
  update(ref(db, "rooms/" + room + "/players/" + user.uid), { score: points });
}

// Leaderboard
function listenScores() {
  onValue(ref(db, "rooms/" + room + "/players"), snapshot => {
    let players = snapshot.val();
    let list = document.getElementById("leaderboardList");
    list.innerHTML = "";
    for (let uid in players) {
      let li = document.createElement("li");
      li.textContent = players[uid].name + ": " + players[uid].score + " poena";
      list.appendChild(li);
    }
  });
}
