// ─── FIREBASE CONFIG ───────────────────────────────────────────────────────
// 🔧 REPLACE these values with your own Firebase project config.
// Get it from: Firebase Console → Project Settings → Your apps → SDK setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAP3taumTM2B-pfBVeQN9Y8yDOojz5_IXE",
  authDomain: "fifa-world-cup-2026-prediction.firebaseapp.com",
  projectId: "fifa-world-cup-2026-prediction",
  storageBucket: "fifa-world-cup-2026-prediction.firebasestorage.app",
  messagingSenderId: "867558876012",
  appId: "1:867558876012:web:dfd174abff12c35fd9c949"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── STATE ─────────────────────────────────────────────────────────────────
let currentUser = null;   // Firebase auth user
let userData = null;      // Firestore user doc
let unsubs = [];          // Firestore listeners to clean up

// ─── HELPERS ───────────────────────────────────────────────────────────────
function phoneToEmail(phone) {
  // Firebase Auth requires email; we synthesize one from phone
  return `${phone.replace(/\D/g, "")}@matchday.app`;
}

function initials(name = "") {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isBeforeKickoff(match) {
  if (!match.kickoff) return false;
  const kickoff = match.kickoff.toDate ? match.kickoff.toDate() : new Date(match.kickoff);
  return new Date() < kickoff;
}

function showMsg(el, text, type = "error") {
  el.textContent = text;
  el.className = `auth-msg ${type}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 4000);
}

// ─── AUTH TABS ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ─── SIGN UP ───────────────────────────────────────────────────────────────
document.getElementById("btn-signup").addEventListener("click", async () => {
  const name  = document.getElementById("signup-name").value.trim();
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const pass  = document.getElementById("signup-password").value;
  const msg   = document.getElementById("signup-msg");

  if (!name) return showMsg(msg, "Please enter your name.");
  if (phone.length < 7) return showMsg(msg, "Enter a valid phone number with country code.");
  if (pass.length < 6)  return showMsg(msg, "Password must be at least 6 characters.");

  const email = phoneToEmail(phone);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      phone,
      uid: cred.user.uid,
      points: 0,
      correct: 0,
      total: 0,
      createdAt: serverTimestamp(),
    });
    showMsg(msg, "Account created!", "success");
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      showMsg(msg, "That phone number is already registered. Try signing in.");
    } else {
      showMsg(msg, e.message);
    }
  }
});

// ─── SIGN IN ───────────────────────────────────────────────────────────────
document.getElementById("btn-login").addEventListener("click", async () => {
  const phone = document.getElementById("login-phone").value.replace(/\D/g, "");
  const pass  = document.getElementById("login-password").value;
  const msg   = document.getElementById("login-msg");

  if (phone.length < 7) return showMsg(msg, "Enter a valid phone number with country code.");
  if (!pass) return showMsg(msg, "Enter your password.");

  const email = phoneToEmail(phone);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found") {
      showMsg(msg, "Phone number or password is incorrect.");
    } else {
      showMsg(msg, e.message);
    }
  }
});

// ─── SIGN OUT ──────────────────────────────────────────────────────────────
document.getElementById("btn-logout").addEventListener("click", async () => {
  unsubs.forEach(u => u());
  unsubs = [];
  await signOut(auth);
});

// ─── AUTH STATE ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const snap = await getDoc(doc(db, "users", user.uid));
    userData = snap.data();
    showApp();
  } else {
    currentUser = null;
    userData = null;
    showAuth();
  }
});

function showAuth() {
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("screen-app").classList.remove("active");
}

function showApp() {
  document.getElementById("screen-auth").classList.remove("active");
  document.getElementById("screen-app").classList.add("active");
  loadMatchesView();
  loadTableView();
  loadProfileView();
}

// ─── NAV ───────────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
  });
});

// ─── MATCHES VIEW ──────────────────────────────────────────────────────────
function loadMatchesView() {
  const container = document.getElementById("matches-list");
  const q = query(collection(db, "matches"));

  const unsub = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div>No matches scheduled yet. Check back soon!</div>`;
      return;
    }

    // Fetch user picks for all matches in one go
    const picksSnap = await getDocs(query(
      collection(db, "picks"),
      where("uid", "==", currentUser.uid)
    ));
    const myPicks = {};
    picksSnap.forEach(d => { myPicks[d.data().matchId] = d.data(); });

    // Sort matches: upcoming first, then live, then finished
    const matches = [];
    snap.forEach(d => matches.push({ id: d.id, ...d.data() }));
    matches.sort((a, b) => {
      const order = { upcoming: 0, live: 1, finished: 2 };
      const ao = order[a.status] ?? 0;
      const bo = order[b.status] ?? 0;
      if (ao !== bo) return ao - bo;
      const at = a.kickoff?.toDate?.() ?? new Date(0);
      const bt = b.kickoff?.toDate?.() ?? new Date(0);
      return at - bt;
    });

    container.innerHTML = "";
    for (const match of matches) {
      container.appendChild(renderMatchCard(match, myPicks[match.id]));
    }
  });

  unsubs.push(unsub);
}

function renderMatchCard(match, myPick) {
  const card = document.createElement("div");
  card.className = "match-card";
  const canPick = match.status === "upcoming" && isBeforeKickoff(match);
  const selectedPick = myPick?.pick || null;

  // 🔥 ADD THIS FIX HERE: Turn Firestore image URLs into <img> elements automatically
  const homeBadgeDisplay = match.homeBadge && match.homeBadge.startsWith('http')
    ? `<img src="${match.homeBadge}" alt="" class="flag-img" />`
    : match.homeBadge || "🏠";

  const awayBadgeDisplay = match.awayBadge && match.awayBadge.startsWith('http')
    ? `<img src="${match.awayBadge}" alt="" class="flag-img" />`
    : match.awayBadge || "✈️";

  card.innerHTML = `
    <div class="match-meta">
      <span class="match-competition">${match.competition || "Match"}</span>
      <span class="match-time">${fmtDate(match.kickoff)}</span>
      <span class="match-status-badge ${match.status || "upcoming"}">${match.status || "upcoming"}</span>
    </div>

    <div class="match-teams">
      <div class="team-side">
        <!-- Changed from ${match.homeBadge || "🏠"} to our new dynamic variable -->
        <div class="team-badge">${homeBadgeDisplay}</div>
        <div class="team-name">${match.homeTeam}</div>
      </div>
      <div>
        ${match.status === "finished" || match.status === "live"
          ? `<div class="match-result">${match.homeScore ?? "–"} : ${match.awayScore ?? "–"}</div>`
          : `<div class="vs-divider">VS</div>`
        }
      </div>
      <div class="team-side">
        <!-- Changed from ${match.awayBadge || "✈️"} to our new dynamic variable -->
        <div class="team-badge">${awayBadgeDisplay}</div>
        <div class="team-name">${match.awayTeam}</div>
      </div>
    </div>

    <div class="pick-section">
      <div class="pick-label">${canPick ? "Your pick" : (match.status === "finished" ? "Result & your pick" : "Your pick (locked)")}</div>
      <div class="pick-chips" id="chips-${match.id}">
        ${renderPickChips(match, selectedPick, canPick)}
      </div>
      <div class="group-picks-summary" id="summary-${match.id}">Loading group picks…</div>
    </div>
  `;

  // Attach pick handlers
  if (canPick) {
    card.querySelectorAll(".pick-chip").forEach(chip => {
      chip.addEventListener("click", () => handlePick(match, chip.dataset.pick));
    });
  }

  // Load group picks summary
  loadGroupSummary(match.id, card.querySelector(`#summary-${match.id}`));

  return card;
}

function renderPickChips(match, selectedPick, canPick) {
  const winner = match.result; // "home" | "away" | "draw"
  const chips = [
    { pick: "home", label: match.homeTeam },
    { pick: "draw", label: "Draw" },
    { pick: "away", label: match.awayTeam },
  ];

  return chips.map(({ pick, label }) => {
    let classes = "pick-chip";
    if (selectedPick === pick) {
      if (winner && match.status === "finished") {
        classes += pick === winner ? " correct" : " wrong";
      } else {
        classes += " selected";
      }
    }
    if (!canPick) classes += " locked";
    return `<button class="${classes}" data-pick="${pick}">${label}${selectedPick === pick ? " ✓" : ""}</button>`;
  }).join("");
}

async function handlePick(match, pick) {
  if (!currentUser) return;
  const pickId = `${currentUser.uid}_${match.id}`;
  await setDoc(doc(db, "picks", pickId), {
    uid: currentUser.uid,
    matchId: match.id,
    pick,
    pickedAt: serverTimestamp(),
  }, { merge: true });

  // Refresh the card chips
  const chips = document.getElementById(`chips-${match.id}`);
  if (chips) {
    chips.innerHTML = renderPickChips(match, pick, true);
    chips.querySelectorAll(".pick-chip").forEach(chip => {
      chip.addEventListener("click", () => handlePick(match, chip.dataset.pick));
    });
  }
}

async function loadGroupSummary(matchId, el) {
  const snap = await getDocs(query(collection(db, "picks"), where("matchId", "==", matchId)));
  const counts = { home: 0, draw: 0, away: 0 };
  snap.forEach(d => { counts[d.data().pick] = (counts[d.data().pick] || 0) + 1; });
  const total = snap.size;
  if (total === 0) { el.textContent = "No picks yet"; return; }

  const pct = (k) => total ? Math.round((counts[k] / total) * 100) : 0;

  el.innerHTML = `
    <span>${total} pick${total !== 1 ? "s" : ""} · Home ${pct("home")}% · Draw ${pct("draw")}% · Away ${pct("away")}%</span>
    <div class="group-picks-bar">
      <div class="bar-home" style="width:${pct("home")}%"></div>
      <div class="bar-draw" style="width:${pct("draw")}%"></div>
      <div class="bar-away" style="width:${pct("away")}%"></div>
    </div>
  `;
}

// ─── TABLE VIEW ────────────────────────────────────────────────────────────
function loadTableView() {
  const container = document.getElementById("table-list");

  const unsub = onSnapshot(collection(db, "users"), (snap) => {
    if (snap.empty) { container.innerHTML = `<div class="empty-state">No players yet.</div>`; return; }

    const players = [];
    snap.forEach(d => players.push({ id: d.id, ...d.data() }));
    players.sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
      return (b.correct || 0) - (a.correct || 0);
    });

    const rankLabels = ["🥇", "🥈", "🥉"];

    container.innerHTML = `
      <div class="table-head">
        <span>#</span>
        <span>Player</span>
        <span style="text-align:right">Played</span>
        <span style="text-align:right">Correct</span>
        <span style="text-align:right">Pts</span>
      </div>
      ${players.map((p, i) => {
        const isMe = p.id === currentUser?.uid;
        const rank = i < 3 ? rankLabels[i] : `${i + 1}`;
        return `
          <div class="table-row ${isMe ? "me" : ""}">
            <span class="table-rank">${rank}</span>
            <div class="table-player">
              <div class="mini-avatar" style="background:${avatarColor(p.name)}">${initials(p.name)}</div>
              <div class="player-info-block">
                <div class="player-name">${p.name}</div>
                ${isMe ? `<span class="you-badge">YOU</span>` : ""}
              </div>
            </div>
            <span class="table-stat">${p.total || 0}</span>
            <span class="table-stat">${p.correct || 0}</span>
            <span class="table-pts">${p.points || 0}</span>
          </div>
        `;
      }).join("")}
    `;
  });

  unsubs.push(unsub);
}

function avatarColor(name = "") {
  const colors = ["#dbeafe", "#e0e7ff", "#fce7f3", "#d1fae5", "#fef3c7", "#fee2e2"];
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xfffff;
  return colors[h % colors.length];
}

// ─── PROFILE VIEW ──────────────────────────────────────────────────────────
function loadProfileView() {
  if (!currentUser || !userData) return;

  document.getElementById("profile-avatar").textContent = initials(userData.name);
  document.getElementById("profile-name").textContent = userData.name;
  document.getElementById("profile-phone").textContent = `+${userData.phone}`;

  const statsEl = document.getElementById("profile-stats");
  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-num">${userData.points || 0}</div><div class="stat-label">Points</div></div>
    <div class="stat-card"><div class="stat-num">${userData.correct || 0}</div><div class="stat-label">Correct</div></div>
    <div class="stat-card"><div class="stat-num">${userData.total || 0}</div><div class="stat-label">Played</div></div>
  `;

  loadPickHistory();
}

async function loadPickHistory() {
  const el = document.getElementById("picks-history-list");
  const picksSnap = await getDocs(query(
    collection(db, "picks"),
    where("uid", "==", currentUser.uid)
  ));

  if (picksSnap.empty) { el.innerHTML = `<div class="empty-state">No picks yet.</div>`; return; }

  // Fetch match data for each pick
  const picks = [];
  picksSnap.forEach(d => picks.push({ id: d.id, ...d.data() }));

  const matchIds = [...new Set(picks.map(p => p.matchId))];
  const matchMap = {};
  for (const mid of matchIds) {
    const mSnap = await getDoc(doc(db, "matches", mid));
    if (mSnap.exists()) matchMap[mid] = mSnap.data();
  }

  picks.sort((a, b) => {
    const at = matchMap[a.matchId]?.kickoff?.toDate?.() ?? new Date(0);
    const bt = matchMap[b.matchId]?.kickoff?.toDate?.() ?? new Date(0);
    return bt - at;
  });

  el.innerHTML = picks.map(p => {
    const match = matchMap[p.matchId];
    if (!match) return "";
    const winner = match.result;
    let resultHtml = `<span class="history-result result-pending">Pending</span>`;
    if (match.status === "finished") {
      if (winner === "draw") {
        resultHtml = `<span class="history-result result-draw">Draw +1pt</span>`;
      } else if (p.pick === winner) {
        resultHtml = `<span class="history-result result-win">+1 pt ✓</span>`;
      } else {
        resultHtml = `<span class="history-result result-loss">0 pts ✗</span>`;
      }
    }
    return `
      <div class="history-item">
        <span class="history-match">${match.homeTeam} vs ${match.awayTeam}</span>
        <span class="history-pick">${p.pick === "home" ? match.homeTeam : p.pick === "away" ? match.awayTeam : "Draw"}</span>
        ${resultHtml}
      </div>
    `;
  }).join("") || `<div class="empty-state">No picks yet.</div>`;
}
