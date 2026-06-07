// ─── FIREBASE CONFIG ───────────────────────────────────────────────────────
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
let currentUser = null;
let userData = null;
let unsubs = [];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function phoneToEmail(phone) {
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

function setButtonLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait…" : label;
}

function showMsg(el, text, type = "error") {
  el.textContent = text;
  el.className = `auth-msg ${type}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 4000);
}

// ─── BADGE HELPER ──────────────────────────────────────────────────────────
// If the stored badge value is a URL, wrap it in an <img>. Otherwise render as-is (emoji).
function renderBadge(badge, teamName) {
  if (!badge) return "🏳️";
  if (badge.startsWith("http")) {
    return `<img src="${badge}" alt="${teamName}" class="flag-img" onerror="this.style.display='none'">`;
  }
  return badge;
}

// ─── SCORING LOGIC ─────────────────────────────────────────────────────────
// Rules (from README):
//   pick === result              → +1 pt, counted as correct
//   result === "draw" + any pick → +1 pt, counted as correct
//   pick !== result (non-draw)   → 0 pts
function evaluatePick(userPick, matchResult) {
  if (!matchResult || !userPick) return null;          // match not finished / no pick
  if (matchResult === "draw") return "win";            // any pick on a draw = point
  if (userPick === matchResult) return "win";          // correct prediction
  return "loss";                                       // wrong prediction
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
const btnSignup = document.getElementById("btn-signup");
btnSignup.addEventListener("click", async () => {
  const name  = document.getElementById("signup-name").value.trim();
  const phone = document.getElementById("signup-phone").value.replace(/\D/g, "");
  const pass  = document.getElementById("signup-password").value;
  const msg   = document.getElementById("signup-msg");

  if (!name) return showMsg(msg, "Please enter your name.");
  if (phone.length < 7) return showMsg(msg, "Enter a valid phone number with country code.");
  if (pass.length < 6)  return showMsg(msg, "Password must be at least 6 characters.");

  setButtonLoading(btnSignup, true, "Create Account");
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
  } finally {
    setButtonLoading(btnSignup, false, "Create Account");
  }
});

// ─── SIGN IN ───────────────────────────────────────────────────────────────
const btnLogin = document.getElementById("btn-login");
btnLogin.addEventListener("click", async () => {
  const phone = document.getElementById("login-phone").value.replace(/\D/g, "");
  const pass  = document.getElementById("login-password").value;
  const msg   = document.getElementById("login-msg");

  if (phone.length < 7) return showMsg(msg, "Enter a valid phone number with country code.");
  if (!pass) return showMsg(msg, "Enter your password.");

  setButtonLoading(btnLogin, true, "Sign In");
  const email = phoneToEmail(phone);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    if (e.code === "auth/invalid-credential" || e.code === "auth/user-not-found") {
      showMsg(msg, "Phone number or password is incorrect.");
    } else {
      showMsg(msg, e.message);
    }
    setButtonLoading(btnLogin, false, "Sign In");
  }
  // On success onAuthStateChanged fires → showApp(); button stays disabled intentionally
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
    // Reset login button in case user signed out manually
    setButtonLoading(btnLogin, false, "Sign In");
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
// myPicksCache is populated once per session and kept in sync by handlePick()
// to avoid re-fetching all picks on every matches snapshot update.
let myPicksCache = null;

async function ensurePicksCache() {
  if (myPicksCache !== null) return;
  myPicksCache = {};
  const snap = await getDocs(
    query(collection(db, "picks"), where("uid", "==", currentUser.uid))
  );
  snap.forEach(d => { myPicksCache[d.data().matchId] = d.data(); });
}

function loadMatchesView() {
  const container = document.getElementById("matches-list");
  const q = query(collection(db, "matches"));

  const unsub = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div>No matches scheduled yet. Check back soon!</div>`;
      return;
    }

    // Populate picks cache once, then reuse
    await ensurePicksCache();

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
      container.appendChild(renderMatchCard(match, myPicksCache[match.id]));
    }
  });

  unsubs.push(unsub);
}

function renderMatchCard(match, myPick) {
  const card = document.createElement("div");
  card.className = "match-card";
  const canPick = match.status === "upcoming" && isBeforeKickoff(match);
  const selectedPick = myPick?.pick || null;

  card.innerHTML = `
    <div class="match-meta">
      <span class="match-competition">${match.competition || "Match"}</span>
      <span class="match-time">${fmtDate(match.kickoff)}</span>
      <span class="match-status-badge ${match.status || "upcoming"}">${match.status || "upcoming"}</span>
    </div>

    <div class="match-teams">
      <div class="team-side">
        <div class="team-badge">${renderBadge(match.homeBadge, match.homeTeam)}</div>
        <div class="team-name">${match.homeTeam}</div>
      </div>
      <div>
        ${match.status === "finished" || match.status === "live"
          ? `<div class="match-result">${match.homeScore ?? "–"} : ${match.awayScore ?? "–"}</div>`
          : `<div class="vs-divider">VS</div>`
        }
      </div>
      <div class="team-side">
        <div class="team-badge">${renderBadge(match.awayBadge, match.awayTeam)}</div>
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

  if (canPick) {
    card.querySelectorAll(".pick-chip").forEach(chip => {
      chip.addEventListener("click", () => openPickModal(match, chip.dataset.pick));
    });
  }

  // Live group summary via onSnapshot (fixed: was getDocs)
  attachGroupSummaryListener(match.id, card.querySelector(`#summary-${match.id}`));
  return card;
}

// ─── SCORING-AWARE CHIP RENDERER ───────────────────────────────────────────
function renderPickChips(match, selectedPick, canPick) {
  const chips = [
    { pick: "home", label: match.homeTeam },
    { pick: "away", label: match.awayTeam },
  ];

  return chips.map(({ pick, label }) => {
    let classes = "pick-chip";
    const isSelected = selectedPick === pick;

    if (isSelected) {
      if (match.status === "finished" && match.result) {
        const outcome = evaluatePick(pick, match.result);
        classes += outcome === "win" ? " correct" : " wrong";
      } else {
        classes += " selected";
      }
    }

    // Highlight winning side on finished matches even if user didn't pick it
    if (match.status === "finished" && match.result) {
      const isWinner = match.result === pick || match.result === "draw";
      if (isWinner && !isSelected) classes += " winner-highlight";
    }

    if (!canPick) classes += " locked";

    const icon = isSelected
      ? (match.status === "finished" && match.result
          ? (evaluatePick(pick, match.result) === "win" ? " ✓" : " ✗")
          : " ✓")
      : "";

    return `<button class="${classes}" data-pick="${pick}">${label}${icon}</button>`;
  }).join("");
}

// ─── PICK HANDLER ──────────────────────────────────────────────────────────
async function handlePick(match, pick) {
  if (!currentUser) return;
  const pickId = `${currentUser.uid}_${match.id}`;

  await setDoc(doc(db, "picks", pickId), {
    uid: currentUser.uid,
    matchId: match.id,
    pick,
    pickedAt: serverTimestamp(),
    scored: false,    // will be flipped to true by scoreMatchForAllUsers
    outcome: null,
  }, { merge: true });

  // Update local cache immediately so chips reflect the new pick without a full reload
  if (myPicksCache) myPicksCache[match.id] = { uid: currentUser.uid, matchId: match.id, pick };

  const chips = document.getElementById(`chips-${match.id}`);
  if (chips) {
    const canPick = match.status === "upcoming" && isBeforeKickoff(match);
    chips.innerHTML = renderPickChips(match, pick, canPick);
    if (canPick) {
      chips.querySelectorAll(".pick-chip").forEach(chip => {
        chip.addEventListener("click", () => openPickModal(match, chip.dataset.pick));
      });
    }
  }
}

// ─── LIVE GROUP SUMMARY ────────────────────────────────────────────────────
// Uses onSnapshot so the bar updates in real-time as others pick.
// Returns the unsubscribe function so callers can clean up if needed.
function attachGroupSummaryListener(matchId, el) {
  return onSnapshot(
    query(collection(db, "picks"), where("matchId", "==", matchId)),
    (snap) => {
      const counts = { home: 0, away: 0 };
      snap.forEach(d => {
        const p = d.data().pick;
        if (p === "home" || p === "away") counts[p]++;
      });
      const total = snap.size;
      if (!el) return;
      if (total === 0) { el.textContent = "No picks yet"; return; }
      const pct = (k) => Math.round((counts[k] / total) * 100);
      el.innerHTML = `
        <span>${total} pick${total !== 1 ? "s" : ""} · Home ${pct("home")}% · Away ${pct("away")}%</span>
        <div class="group-picks-bar">
          <div class="bar-home" style="width:${pct("home")}%"></div>
          <div class="bar-away" style="width:${pct("away")}%"></div>
        </div>
      `;
    }
  );
}

// ─── MODAL (PICK CONFIRMATION) ─────────────────────────────────────────────
const pickModal   = document.getElementById("pick-modal");
const modalClose  = document.getElementById("modal-close");
const modalTitle  = document.getElementById("modal-title");
const modalSub    = document.getElementById("modal-subtitle");
const modalTeams  = document.getElementById("modal-teams");

let pendingMatchForModal = null;

function openPickModal(match, preselectedPick = null) {
  pendingMatchForModal = match;
  modalTitle.textContent = `${match.homeTeam} vs ${match.awayTeam}`;
  modalSub.textContent   = fmtDate(match.kickoff);

  const currentPick = myPicksCache?.[match.id]?.pick || null;

  modalTeams.innerHTML = [
    { pick: "home", label: match.homeTeam, badge: match.homeBadge },
    { pick: "away", label: match.awayTeam, badge: match.awayBadge },
  ].map(({ pick, label, badge }) => {
    return `
      <button class="modal-team-btn" data-pick="${pick}">
        <span class="modal-team-badge">${renderBadge(badge, label)}</span>
        <span class="modal-team-name">${label}</span>
      </button>
    `;
  }).join("");

  // Wire up team buttons inside modal
  modalTeams.querySelectorAll(".modal-team-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await handlePick(match, btn.dataset.pick);
      closePickModal();
    });
  });

  pickModal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closePickModal() {
  pickModal.style.display = "none";
  document.body.style.overflow = "";
  pendingMatchForModal = null;
}

modalClose.addEventListener("click", closePickModal);
pickModal.addEventListener("click", (e) => {
  if (e.target === pickModal) closePickModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePickModal();
});

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
        <span style="text-align:center">Played</span>
        <span style="text-align:center">Correct</span>
        <span style="text-align:center">Pts</span>
      </div>
      ${players.map((p, i) => {
        const isMe = p.id === currentUser?.uid;
        const rank = i < 3 ? rankLabels[i] : `${i + 1}`;
        return `
          <div class="table-row ${isMe ? "me" : ""}">
            <span class="table-rank">${rank}</span>
            <div class="table-player">
              <div class="mini-avatar" style="background:${avatarColor(p.name)}">${initials(p.name)}</div>
              <div>
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

    // Keep in-memory userData fresh so profile stats don't lag
    const me = players.find(p => p.id === currentUser?.uid);
    if (me) userData = { ...userData, ...me };
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
  document.getElementById("profile-name").textContent   = userData.name;
  document.getElementById("profile-phone").textContent  = `+${userData.phone}`;

  // Keep profile stats live by listening to this user's doc
  const userUnsub = onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    userData = { ...userData, ...d };
    const statsEl = document.getElementById("profile-stats");
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-num">${d.points || 0}</div><div class="stat-label">Points</div></div>
        <div class="stat-card"><div class="stat-num">${d.correct || 0}</div><div class="stat-label">Correct</div></div>
        <div class="stat-card"><div class="stat-num">${d.total || 0}</div><div class="stat-label">Played</div></div>
      `;
    }
  });
  unsubs.push(userUnsub);

  loadPickHistory();
}

// ─── PICK HISTORY ──────────────────────────────────────────────────────────
// Batches match fetches with a single getDocs call using `__name__` in array
// instead of N sequential getDoc calls.
async function loadPickHistory() {
  const el = document.getElementById("picks-history-list");
  const picksSnap = await getDocs(
    query(collection(db, "picks"), where("uid", "==", currentUser.uid))
  );

  if (picksSnap.empty) { el.innerHTML = `<div class="empty-state">No picks yet.</div>`; return; }

  const picks = [];
  picksSnap.forEach(d => picks.push({ id: d.id, ...d.data() }));

  // Batch fetch all match docs (Firestore `in` supports up to 30 items)
  const matchIds = [...new Set(picks.map(p => p.matchId))];
  const matchMap = {};

  // Split into chunks of 30 to respect Firestore limits
  const chunks = [];
  for (let i = 0; i < matchIds.length; i += 30) chunks.push(matchIds.slice(i, i + 30));

  for (const chunk of chunks) {
    // Fetch each doc individually but in parallel (no composite index needed)
    const fetches = chunk.map(mid => getDoc(doc(db, "matches", mid)));
    const results = await Promise.all(fetches);
    results.forEach(snap => { if (snap.exists()) matchMap[snap.id] = snap.data(); });
  }

  picks.sort((a, b) => {
    const at = matchMap[a.matchId]?.kickoff?.toDate?.() ?? new Date(0);
    const bt = matchMap[b.matchId]?.kickoff?.toDate?.() ?? new Date(0);
    return bt - at;
  });

  el.innerHTML = picks.map(p => {
    const match = matchMap[p.matchId];
    if (!match) return "";

    const pickedTeam = p.pick === "home" ? match.homeTeam : match.awayTeam;

    let resultHtml = `<span class="history-result result-pending">Pending</span>`;
    if (match.status === "finished" && match.result) {
      const outcome = evaluatePick(p.pick, match.result);
      if (outcome === "win") {
        resultHtml = `<span class="history-result result-win">+1 pt ✓</span>`;
      } else {
        resultHtml = `<span class="history-result result-loss">0 pts ✗</span>`;
      }
    }

    // Show what the actual result was on finished matches
    const resultInfo = match.status === "finished" && match.result
      ? `<span class="history-actual">Result: ${match.result === "draw" ? "Draw" : match.result === "home" ? match.homeTeam : match.awayTeam}</span>`
      : "";

    return `
      <div class="history-item">
        <div class="history-left">
          <span class="history-match">${match.homeTeam} vs ${match.awayTeam}</span>
          <span class="history-pick">Picked: ${pickedTeam}</span>
          ${resultInfo}
        </div>
        ${resultHtml}
      </div>
    `;
  }).join("") || `<div class="empty-state">No picks yet.</div>`;
}
