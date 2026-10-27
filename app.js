/* Viral Tags for YouTube. Console stays silent unless DEBUG is true. */
const DEBUG = true;                     // production: false. Testing ke time true karo
const log = {
  info: (...a) => { if (DEBUG) console.log("%c[ViralTags]", "color:#D92D20;font-weight:bold", ...a); },
  warn: (...a) => { if (DEBUG) console.warn("[ViralTags]", ...a); },
  error: (...a) => { if (DEBUG) console.error("[ViralTags]", ...a); }
};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

firebase.initializeApp(firebaseConfig);

/* Internet band / network toot gaya: retry nahi, seedha saaf message */
function netErr() {
  const e = new Error("No internet connection. Please check your data or Wi-Fi and try again.");
  e.safe = true; e.offline = true;
  return e;
}
const isNetFail = (e) => !!e && (e.name === "TypeError" || e.code === "auth/network-request-failed");

async function api(action, payload, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const u = opts.user || currentUser;
  if (!opts.anon && u) {
    try { headers.Authorization = "Bearer " + await u.getIdToken(); }
    catch (e) { throw isNetFail(e) ? netErr() : e; }
  }
  let res;
  try { res = await fetch(`${API_URL}?action=${action}`, { method: "POST", headers, body: JSON.stringify(payload || {}) }); }
  catch (e) { throw netErr(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Server error " + res.status);
    e.safe = res.status >= 400 && res.status < 500;       // 4xx messages are written for users, safe to show
    e.status = res.status; e.stage = action;
    throw e;
  }
  return data;
}
/* ---------- Views & Auth ---------- */
let currentUser = null, signupMode = false;
let signingUp = false;                                   // true while a manual sign-up is in progress (user must verify email first)

function showHome() {
  if (typeof TUT !== "undefined" && (TUT.step === 4 || TUT.step === 45)) tutHide();
  histStop();                                            // history ka scroll-loading band
  $("authView").classList.add("hidden");
  $("setupView").classList.add("hidden");
  $("historyView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  window.scrollTo(0, 0);
}
function showAuth(signup) {
  setMode(signup);
  histStop();
  $("historyView").classList.add("hidden");
  $("setupView").classList.add("hidden");
  maybeStartLoginTutorial();
  $("homeView").classList.add("hidden");
  $("authView").classList.remove("hidden");
  log.info("Opened", signup ? "sign up" : "log in", "page");
}
function setMode(signup) {
  signupMode = signup;
  $("authTitle").textContent = signup ? "Create your account" : "Welcome back";
  $("nameWrap").classList.toggle("hidden", !signup);
  $("switchText").textContent = signup ? "Already have an account?" : "Don't have an account?";
  $("switchLink").textContent = signup ? "Log in" : "Sign up";
  $("aPass").autocomplete = signup ? "new-password" : "current-password";
  $("aEmail").type = signup ? "email" : "text";
  $("aEmail").placeholder = signup ? "Email address" : "Email or username";
  $("authMsg").textContent = "";
}
$("switchLink").onclick = (e) => { e.preventDefault(); setMode(!signupMode); };
$("brandHome").onclick = (e) => { e.preventDefault(); showHome(); };
$("brandAuth").onclick = (e) => { e.preventDefault(); showHome(); };
$("openLogin").onclick = () => showAuth(false);
$("openSignup").onclick = () => showAuth(true);

function authError(e) {
  log.error("Auth error:", e);
  const map = {
    "auth/invalid-email": "Enter a valid email address.",
    "auth/user-not-found": "Incorrect email/username or password.",      // same text as wrong password: no account guessing
    "auth/wrong-password": "Incorrect email/username or password.",
    "auth/invalid-credential": "Incorrect email/username or password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password must be at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/unauthorized-domain": "This domain is not authorized for sign-in."
  };
  $("authMsg").textContent = map[e.code] || (e.safe ? e.message : "Something went wrong. Please try again.");
}

/* ---------- Username helpers (final check + reservation happen in the Worker) ---------- */
const cleanUser = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
const validUser = (s) => /^[a-z0-9_]{3,20}$/.test(s);
const PASS_MIN = 8;

$("authBtn").onclick = async () => {
  let email = $("aEmail").value.trim(); const pass = $("aPass").value;
  $("authMsg").textContent = "";
  if (!email || !pass) { $("authMsg").textContent = "Enter your email/username and password."; return; }
  $("authBtn").disabled = true;
  try {
    if (signupMode) {
      const name = cleanUser($("aName").value);
      if (!validUser(name)) { $("authMsg").textContent = "Username: 3-20 letters, numbers or _ only."; return; }
      if (pass.length < PASS_MIN) { $("authMsg").textContent = "Password must be at least " + PASS_MIN + " characters."; return; }
      if (!(await api("check", { name }, { anon: true })).available) { $("authMsg").textContent = "This username is taken."; return; }
      signingUp = true;                                    // keep the app closed until the email is verified
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      try { await api("claim", { name }, { user: cred.user }); }
      catch (e) {                                          // username lost a race: undo the account so they can retry
        await cred.user.delete().catch(() => {});
        $("authMsg").textContent = e.safe ? e.message : "Something went wrong. Please try again.";
        return;
      }
      await cred.user.sendEmailVerification().catch((e) => log.warn("Verify mail:", e));
      await firebase.auth().signOut();
      setMode(false);
      $("authMsg").textContent = "We sent a verification link to " + email + ". Verify it, then log in.";
      return;
    } else if (!email.includes("@")) {                    // username login: the Worker finds the email, email is never sent to the browser
      const r = await api("login", { username: email, password: pass }, { anon: true });
      await firebase.auth().signInWithCustomToken(r.customToken);
    } else {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
    }
  } catch (e) { authError(e); }
  finally { signingUp = false; $("authBtn").disabled = false; }
};

$("googleBtn").onclick = async () => {
  tutOn("gclick");
  try {
    await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) { authError(e); tutOn("gfail"); }
};

/* Avatar menu */
function setPop(open) {
  $("pop").classList.toggle("hidden", !open);
  $("avatarBtn").setAttribute("aria-expanded", String(open));
}
$("avatarBtn").onclick = (e) => { e.stopPropagation(); setPop($("pop").classList.contains("hidden")); };
document.addEventListener("click", (e) => { if (!$("userMenu").contains(e.target)) setPop(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setPop(false); $("loginModal").classList.add("hidden"); } });
$("logoutBtn").onclick = () => { setPop(false); firebase.auth().signOut(); };

function renderAvatar(user) {
  const b = $("avatarBtn");
  b.textContent = ""; b.style.backgroundImage = "";
  if (user.photoURL) {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => { b.style.backgroundImage = `url("${user.photoURL}")`; };
    img.onerror = () => { b.textContent = initial(user); };
    img.src = user.photoURL;
  } else b.textContent = initial(user);
}
const initial = (u) => ((u.displayName || u.email || "U")[0] || "U").toUpperCase();

firebase.auth().onAuthStateChanged(async (user) => {
  currentUser = user;
  if (user && signingUp) return;                        // sign-up in progress: wait until the email is verified
  if (user && !user.emailVerified) {                    // Google users are always verified; fake/unverified emails stop here
    const em = user.email || "";
    try { await user.sendEmailVerification(); } catch (_) {}
    await firebase.auth().signOut();
    showAuth(false);
    $("authMsg").textContent = "Please verify your email first. We sent a link to " + em + ".";
    return;
  }
  document.documentElement.classList.remove("was-in");          // remove header placeholders
  try { localStorage.setItem("trendly_auth", user ? "1" : "0"); } catch (_) {}
  $("guestActions").classList.toggle("hidden", !!user);
  $("userMenu").classList.toggle("hidden", !user);
  $("fbOpen").classList.toggle("hidden", !user);
  $("menuBtn").classList.toggle("hidden", !user);
  $("fbLink").classList.toggle("hidden", !user);
  updateWnew();
  $("adminLink").classList.toggle("hidden", !(user && ADMIN_EMAILS.includes((user.email || "").toLowerCase())));
  if (user) {
    log.info("Signed in");
    renderAvatar(user);
    $("popEmail").textContent = user.email || user.displayName || "Account";
    if (await needsSetup(user)) { showSetup(user); return; }
    enterApp(user);
  } else {
    log.info("Browsing as guest");
    histStop();
    resetCoins();
    setDrawer(false); tutHide(); $("historyView").classList.add("hidden");
    $("setupView").classList.add("hidden");
    $("doneModal").classList.add("hidden");
    setPop(false);
    if ($("authView").classList.contains("hidden")) showHome();
  }
});

function enterApp(user) {
  showHome();
  sweepHistory(user.uid);
  refreshCoins();
  linkVisitor(user);
  if (TUT.step === 4 || TUT.step === 45) tutHide();
  try { localStorage.setItem("trendly_login_tut", "1"); } catch (_) {}
  maybeStartTutorial(user);
}

/* ---------- Complete profile (new Google users) ---------- */
// New = signed in with Google only (no password yet) and no saved profile
async function needsSetup(user) {
  const ids = user.providerData.map(p => p.providerId);
  if (!ids.includes("google.com") || ids.includes("password")) return false;
  try { return !(await firebase.database().ref("users/" + user.uid).once("value")).exists(); }
  catch (e) { log.warn("needsSetup failed:", e); return false; }
}
function showSetup(user) {
  tutHide();
  $("homeView").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("historyView").classList.add("hidden");
  $("setupView").classList.remove("hidden");
  $("sName").value = cleanUser(user.displayName || (user.email || "").split("@")[0]);
  $("sPass").value = ""; $("sPass2").value = ""; $("sMsg").textContent = "";
  window.scrollTo(0, 0);
}
$("sCancel").onclick = (e) => { e.preventDefault(); firebase.auth().signOut(); };

$("sBtn").onclick = async () => {
  const user = currentUser, msg = $("sMsg");
  const name = cleanUser($("sName").value), p1 = $("sPass").value, p2 = $("sPass2").value;
  msg.textContent = "";
  if (!user) return;
  if (!validUser(name)) { msg.textContent = "Username: 3-20 letters, numbers or _ only."; return; }
  if (p1.length < PASS_MIN) { msg.textContent = "Password must be at least " + PASS_MIN + " characters."; return; }
  if (p1 !== p2) { msg.textContent = "Passwords do not match."; return; }
  $("sBtn").disabled = true;
  try {
    if (!(await api("check", { name }, { anon: true })).available) { msg.textContent = "This username is taken. Try another."; return; }
    try { await user.linkWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, p1)); }
    catch (e) { if (e.code !== "auth/provider-already-linked") throw e; }     // retry after a taken username is fine
    await api("claim", { name });                         // profile is created by the Worker (no email inside)
    $("sName").value = name;
    $("doneModal").classList.remove("hidden");
    $("doneGo").focus();
  } catch (e) {
    log.error("Setup:", e);
    msg.textContent = e.code === "auth/weak-password" ? "Password must be at least " + PASS_MIN + " characters."
      : e.safe ? e.message
      : "Something went wrong. Please try again.";
  } finally { $("sBtn").disabled = false; }
};
$("doneGo").onclick = () => { $("doneModal").classList.add("hidden"); enterApp(currentUser); };

/* Login-required modal */
$("modalOk").onclick = () => { $("loginModal").classList.add("hidden"); showAuth(false); };

/* ---------- Coins (shown at the top of the side menu) ---------- */
const COST = { tags: 10, hook: 5, prompt: 6 };           // the Worker has the final say; this is only for labels                 // the Worker has the final say; this is only for labels
const coin = { left: null, max: 80 };
function renderCoins(left, max) {
  if (typeof left === "number") coin.left = left;
  if (typeof max === "number") coin.max = max;
  $("coinNum").textContent = coin.left == null ? "--" : coin.left;
  const n = $("coinNum");
  if (coin.left == null) n.removeAttribute("data-set");
  else { n.setAttribute("data-set", ""); n.style.setProperty("--coin-h", Math.round(120 * Math.max(0, Math.min(1, coin.left / (coin.max || 1))))); }
  $("coinMax").textContent = coin.left == null ? "" : "/ " + coin.max;
  $("costTags").textContent = COST.tags + " coins";
  $("costHook").textContent = COST.hook + " coins";
  if ($("costPrompt")) $("costPrompt").textContent = COST.prompt + " coins";
}
function resetCoins() { coin.left = null; renderCoins(); }
async function refreshCoins() {
  if (!currentUser) return;
  try {
    const r = await api("coins", {});
    if (r.cost) Object.assign(COST, r.cost);
    renderCoins(r.left, r.max);
    updateGoLabel();
  } catch (e) { log.warn("Coins:", e); }
}

/* ---------- Mode: Tags & Hashtags  <->  Suggestion (hook check)  <->  Competitor Tags ---------- */
const HOOK_SECS = 10;
let mode = "tags";
const MODES = {
  tags: {
    title: "What video are we optimizing today?",
    sub: "Tags, hashtags and titles for YouTube",
    drop: 'Drag and drop a video here (max <span class="maxmb">300</span> MB)',
    go: "Analyze video", toggle: "Suggestion", icon: '<i class="fa-solid fa-lightbulb"></i>'
  },
  hook: {
    title: "How strong is your video's hook?",
    sub: "Score your hook and get stronger lines",
    drop: 'Drag and drop a video here (max <span class="maxmb">300</span> MB)',
    go: "Check my hook", toggle: "Tags & Hashtags", icon: '<i class="fa-solid fa-hashtag"></i>'
  },
    ct: {
    title: "Find the tags of any YouTube video",
    sub: "Paste a link to see its tags and description",
    drop: 'Drag and drop a video here (max <span class="maxmb">300</span> MB)',
    go: "Get details", toggle: "Suggestion", icon: '<i class="fa-solid fa-lightbulb"></i>'
  },
  prompt: {
    title: "Turn any idea into an AI video prompt",
    sub: "Add a video, an idea, or both",
    drop: 'Drag and drop a video here (max <span class="maxmb">300</span> MB)',
    go: "Make prompt", toggle: "Suggestion", icon: '<i class="fa-solid fa-lightbulb"></i>'
  }
};
function updateGoLabel() { if (mode === "ct" || mode === "prompt") return; $("go").textContent = MODES[mode].go; }
/* Smooth mode switch: only opacity + transform move, so it stays smooth on phones */
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.22,.8,.3,1)";
let switching = false;

function fadeSwap(el, change, delay = 0) {
  if (!el.animate || reduceMotion()) { change(); return Promise.resolve(); }
  return new Promise((done) => {
    setTimeout(() => {
      const out = el.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-8px)" }],
        { duration: 160, easing: "ease-in", fill: "forwards" });
      out.onfinish = () => {
        change();
        const inn = el.animate(
          [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 280, easing: EASE });
        out.cancel();
        inn.onfinish = () => done();
      };
    }, delay);
  });
}

function fadeHide(el, animate) {
  if (!el || el.classList.contains("hidden")) return Promise.resolve();
  if (!animate || !el.animate || reduceMotion()) { el.classList.add("hidden"); return Promise.resolve(); }
  return new Promise((done) => {
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    a.onfinish = () => { el.classList.add("hidden"); a.cancel(); done(); };
  });
}
const modeDone = { tags: false, hook: false, prompt: false };   // kis mode ka result ban chuka hai
const CT_BTN = {
  on:  { lbl: "Tags & Hashtags", ic: '<i class="fa-solid fa-hashtag"></i>' },
    off: { lbl: "Competitor", ic: '<i class="fa-solid fa-chart-line"></i>' }
};

function fadeShow(el, animate) {
  const was = el.classList.contains("hidden");
  el.classList.remove("hidden");
 if (el.id === "drop" || el.id === "ctInput" || el.id === "ctResults" || el.id === "pmInput" || el.id === "pmResults") return Promise.resolve();   // inka animation CSS karta hai
  if (!was || !animate || !el.animate || reduceMotion()) return Promise.resolve();
  return new Promise((done) => {
    const a = el.animate(
      [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 280, easing: EASE });
    a.onfinish = () => done();
  });
}
function swapBoxes(showEl, hideEl, animate) {            // one fades out, then the other fades in
  return fadeHide(hideEl, animate).then(() => fadeShow(showEl, animate));
}
/* Is mode ke liye buttons kya dikhen: koi video nahi = idle, video hai = ready, result ban chuka = done */
const modeUiState = (m) => !chosen ? "idle" : modeDone[m] ? "done" : "ready";
/* Video preview tayyar ho jaaye tab hi buttons dikhao, warna buttons upar-neeche kudte hain */
function previewReady(ms) {
  const v = $("preview").querySelector("video");
  if (!v || v.readyState >= 2) return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    v.addEventListener("loadeddata", () => { clearTimeout(t); res(); }, { once: true });
  });
}
async function settleButtons(m, animate) {
  const st = modeUiState(m);
  if (!animate) { updateGoLabel(); setUI(st); return; }
  // button pehle se dikh raha hai aur dikhta rahega: sirf uska text fade hoke badle
  if ($("go").offsetParent && st === "ready") { await fadeSwap($("go"), updateGoLabel, 0); return; }
  if ($("btnRow").classList.contains("hidden") && st !== "idle" && st !== "running") await previewReady(500);
  await setUIAnimated(st);
}
const PM_BTN = {
  on:  { lbl: "Tags & Hashtags", ic: '<i class="fa-solid fa-hashtag"></i>' },
  off: { lbl: "Video Prompt", ic: '<i class="fa-solid fa-film"></i>' }
};
function applyMode(m, animate = false) {
  mode = m;
  try { localStorage.setItem("trendly_mode", m); } catch (_) {}   // user ka aakhri mode yaad rahe
  ctMode = m === "ct";
  const pmMode = m === "prompt";
  if (ctMode) ctShowSub();              // wapas aane par button "Fetched ✓" hi dikhe
  const t = ctMode ? { ...MODES.ct, title: CT_SUB[ctSub].title, sub: CT_SUB[ctSub].sub } : MODES[m];
  const cb = ctMode ? CT_BTN.on : CT_BTN.off, pb = pmMode ? PM_BTN.on : PM_BTN.off;
  $("modeBtn").classList.toggle("is-hook", m === "hook");
  $("ctBtn").classList.toggle("is-hook", ctMode);
  $("pBtn").classList.toggle("is-hook", pmMode);
  hideError();
  const swap = animate ? fadeSwap : (el, change) => { change(); return Promise.resolve(); };
  // har mode ka result sirf apne mode mein dikhe, aur wapas aane par wahi purana result
  const showRes = {
    results: m === "tags" && modeDone.tags, hookResults: m === "hook" && modeDone.hook,
    pmResults: pmMode && modeDone.prompt, ctResults: ctMode && (ctDone || ctBusy)
  };
  const late = (id) => id === "ctResults" || id === "pmResults";    // ye input box aane ke baad dikhte hain
  const jobs = [
    swap($("heroTitle"), () => { $("heroTitle").textContent = t.title; }, 0),
    swap($("heroSub"), () => { $("heroSub").textContent = t.sub; }, 60),
    swap($("dropText"), () => {
      $("dropText").innerHTML = t.drop;
      $("dropText").querySelectorAll(".maxmb").forEach(e => e.textContent = MAX_MB);
    }, 120),
    ...["results", "hookResults", "pmResults", "ctResults"].map(id => showRes[id] ? (late(id) ? Promise.resolve() : fadeShow($(id), animate)) : fadeHide($(id), animate))
  ];
  // sirf wahi button swap hota hai jiska label badalta hai, taaki do same buttons na dikhein
  if ($("modeLbl").textContent !== t.toggle) {
    jobs.push(swap($("modeLbl"), () => { $("modeLbl").textContent = t.toggle; }, 0));
    jobs.push(swap($("modeIc"), () => { $("modeIc").innerHTML = t.icon; }, 0));
  }
  if ($("ctLbl").textContent !== cb.lbl) {
    jobs.push(swap($("ctLbl"), () => { $("ctLbl").textContent = cb.lbl; }, 0));
    jobs.push(swap($("ctIc"), () => { $("ctIc").innerHTML = cb.ic; }, 0));
  }
  if ($("pLbl").textContent !== pb.lbl) {
    jobs.push(swap($("pLbl"), () => { $("pLbl").textContent = pb.lbl; }, 0));
    jobs.push(swap($("pIc"), () => { $("pIc").innerHTML = pb.ic; }, 0));
  }
  // teen input boxes (upload / link / video prompt): baaki do chhupte hain, phir ek aata hai
  const boxes = [$("drop"), $("ctInput"), $("pmInput")];
  const showBox = ctMode ? $("ctInput") : pmMode ? $("pmInput") : $("drop");
  const boxSwap = Promise.all(boxes.filter(b => b !== showBox).map(b => fadeHide(b, animate))).then(() => fadeShow(showBox, animate));
  jobs.push(boxSwap);
  // buttons: pehle boxes badal jaayein, phir buttons aayein (taaki upar-neeche na kudein)
  if (ctMode || pmMode) jobs.push(fadeHide($("btnRow"), animate));
  else jobs.push(boxSwap.then(() => settleButtons(m, animate)));
  if (showRes.ctResults) jobs.push(boxSwap.then(() => fadeShow($("ctResults"), animate)));   // link box aane ke baad hi result dikhe
  if (showRes.pmResults) jobs.push(boxSwap.then(() => fadeShow($("pmResults"), animate)));
  log.info("Mode:", m);
  return Promise.all(jobs);
}
$("modeBtn").onclick = () => {
  if (running || switching) return;
  switching = true;
  const b = $("modeBtn");
  if (b.animate && !reduceMotion()) {
    b.animate([{ transform: "scale(1)" }, { transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 260, easing: EASE });
  }
  applyMode(mode === "hook" ? "tags" : "hook", true).then(() => { switching = false; });
};
/* ---------- File selection ---------- */
let chosen = null;
function showError(m) { $("errBox").textContent = m; $("errBox").classList.remove("hidden"); }
function hideError() { $("errBox").classList.add("hidden"); }

/* Button states: idle (none) | ready (Analyze + Upload another) | running (none) | done (Upload another only) */
let uiState = "idle", uiTok = 0;
function setUI(state) {
  uiState = state;
  uiTok++;                                               // purani animation ko rok do
  $("btnRow").classList.toggle("hidden", state === "idle" || state === "running");
  $("go").classList.toggle("hidden", state !== "ready");
  $("again").classList.toggle("hidden", state !== "ready" && state !== "done");
  $("modeBtn").disabled = state === "running";
  $("ctBtn").disabled = state === "running";
 $("pBtn").disabled = state === "running";
}
setUI("idle");
/* Buttons ko animation ke saath dikhao / chhupao (pehle purane hatao, phir naye laao) */
function setUIAnimated(state) {
  uiState = state;
  const tok = ++uiTok;
  $("modeBtn").disabled = state === "running";
  $("ctBtn").disabled = state === "running";
 $("pBtn").disabled = state === "running";
  const items = [
    [$("btnRow"), !(state === "idle" || state === "running")],
    [$("go"), state === "ready"],
    [$("again"), state === "ready" || state === "done"]
  ];
  const hide = items.filter(([, on]) => !on).map(([el]) => fadeHide(el, true));
  return Promise.all(hide).then(() => {
    if (tok !== uiTok) return;                           // beech me state badal gayi
    updateGoLabel();                                     // button chhupa hai, ab label badlo, phir dikhao
    return Promise.all(items.filter(([, on]) => on).map(([el]) => fadeShow(el, true)));
  });
}
$("again").onclick = () => { $("file").value = ""; $("file").click(); };

function setFile(f) {
  if (running) return;
  hideError();
  if (!f) return;
  if (!f.type.startsWith("video")) return showError("Please choose a video file.");
  if (f.size > MAX_SIZE) return showError(`File is too large. The maximum size is ${Math.round(MAX_SIZE / 1048576)} MB.`);   // the Worker checks this again
  chosen = f;
  $("fname").textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
  $("preview").innerHTML = "";
  const v = document.createElement("video");
  v.preload = "auto"; v.playsInline = true;
  v.addEventListener("loadedmetadata", () => { try { v.currentTime = 0.001; } catch (_) {} });   // pehla frame turant dikhe
  v.src = URL.createObjectURL(f);
  v.controls = true;
  $("preview").appendChild(v);
  $("results").classList.add("hidden");
  $("hookResults").classList.add("hidden");
  modeDone.tags = false; modeDone.hook = false;          // naya video: purane results hata do
    previewReady(500).then(() => { if (chosen === f && !running) setUIAnimated("ready"); });
  $("dropEmpty").classList.add("hidden");
  log.info("Video selected:", f.name, f.type, f.size + " bytes");
  tutOn("selected");
}
$("pick").onclick = () => { tutOn("pick"); $("file").click(); };
$("file").onchange = (e) => setFile(e.target.files[0]);
["dragover", "dragenter"].forEach(ev => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

/* ---------- Tag Finder (YouTube Data API via Worker, no coins) ---------- */
let ctMode = false, ctLastId = null, ctBusy = false, ctTok = 0, ctDone = false, ctSub = "";
const ctYtThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const ctWhen = (iso) => {                                // exact upload date and time
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
};
const ctDay = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const ctStatList = (v) => [
  ["Views / day", v.viewsPerDay], ["Viral score", v.viral], ["Type", v.kind], ["Duration", v.duration]
].filter(([, x]) => x);
const ctMoreList = (v, ch) => [
  ["Category", v.category], ["Topics", (v.topics || []).join(", ")], ["Quality", v.hd],
  ["Captions", v.captions], ["Made for kids", v.kids], ["Language", v.lang],
  ["Subscribers", ch.subs], ["Channel created", ch.created ? ctDay(ch.created) : ""],
  ["Channel videos", ch.videos], ["Channel total views", ch.totalViews], ["Channel country", ch.country]
].filter(([, x]) => x);

$("ctBtn").onclick = () => {
  if (running || switching) return;
  switching = true;
  applyMode(mode === "ct" ? "tags" : "ct", true).then(() => { switching = false; });
};

function ytIdFromUrl(u) {
  const s = String(u || "").trim();
  const m = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

/* ---- Competitor box: ctSub = "" (compare 2 videos) | "tags" (Tag Finder) | "plan" (Channel Planner) ---- */
const CT_SUB = {
  "":   { title: "Compare your video with a competitor", sub: "Find the tags your competitor is using", btn: "Compare tags", p1: "Your video link", two: true },
  tags: { title: "Find the tags of any YouTube video", sub: "Paste a link to see its tags and stats", btn: "Get details", p1: "https://youtube.com/watch?v=…", two: false },
  plan: { title: "Plan the best days to upload videos", sub: "Find the best day to upload your video", btn: "Plan my uploads", p1: "Channel link or @handle", two: false }
};

function chanFromUrl(u) {                                // channel link / @handle / UC... id
  const s = String(u || "").trim();
  if (!s || s.length > 200) return null;
  const ok = /^@[\w.-]{3,}$/.test(s) || /^UC[\w-]{22}$/.test(s) || /youtube\.com\/(@|channel\/|c\/|user\/)/i.test(s);
  return ok ? s : null;
}
/* Is waqt inputs se ek "key" banti hai. Wahi key dobara ho to button "Fetched ✓" rehta hai. */
function ctKey() {
  const a = $("ctUrl").value;
  if (ctSub === "") { const x = ytIdFromUrl(a), y = ytIdFromUrl($("ctUrl2").value); return x && y ? x + "|" + y : null; }
  if (ctSub === "tags") return ytIdFromUrl(a);
  return chanFromUrl(a);
}
/* Har tab ke apne links aur apna result yaad rakho */
const ctVals = { "": { u1: "", u2: "" }, tags: { u1: "", u2: "" }, plan: { u1: "", u2: "" } };
const ctS = { "": { last: null, done: false }, tags: { last: null, done: false }, plan: { last: null, done: false } };
function ctSave() {
  ctVals[ctSub] = { u1: $("ctUrl").value, u2: $("ctUrl2").value };
  try { localStorage.setItem("trendly_ct", JSON.stringify({ sub: ctSub, vals: ctVals })); } catch (_) {}
}
function ctShowPanels(sub) {                             // sirf is tab ka result dikhe (agar bana hua hai)
  $("ctResults").classList.toggle("hidden", !ctDone);
  $("ctVideo").classList.toggle("hidden", sub !== "tags");
  $("ctBody").classList.toggle("hidden", sub !== "tags");
  $("cmpBody").classList.toggle("hidden", sub !== "");
  $("planBody").classList.toggle("hidden", sub !== "plan");
}
function ctSetBtn() {
  const key = ctKey(), same = !!key && key === ctLastId, b = $("ctGo");
 ctSave();
  b.disabled = ctBusy || same;
  b.textContent = ctBusy ? "Fetching…" : same ? "Fetched ✓" : CT_SUB[ctSub].btn;
}
function ctShowSub() {                                   // tab highlight + 1 ya 2 input box
  const c = CT_SUB[ctSub];
    $("ctUrl").value = ctVals[ctSub].u1;
  $("ctUrl2").value = ctVals[ctSub].u2;
  document.querySelectorAll("#ctTabs .ct-tab").forEach(b => b.classList.toggle("on", b.dataset.sub === ctSub));
  $("ctUrl").placeholder = c.p1;
  $("ctUrl").setAttribute("aria-label", c.p1);
  $("ctUrl2").classList.toggle("hidden", !c.two);
  ctSetBtn();
}
function ctClear() {                                     // tab badla: purana result hata do
  ctTok++; ctLastId = null; ctBusy = false; ctDone = false;
  $("ctResults").classList.add("hidden");
  hideError();
}
$("ctTabs").onclick = (e) => {
  const b = e.target.closest(".ct-tab");
  if (!b || ctBusy) return;
  ctSave();                                              // purane tab ke links
  ctS[ctSub] = { last: ctLastId, done: ctDone };         // purane tab ka result yaad
  ctSub = ctSub === b.dataset.sub ? "" : b.dataset.sub;  // same tab dobara = band, compare wapas
  ctLastId = ctS[ctSub].last; ctDone = ctS[ctSub].done;  // naye tab ka result wapas
  hideError();
  document.querySelectorAll("#ctTabs .ct-tab").forEach(t => t.classList.toggle("on", t.dataset.sub === ctSub));
  if (b.animate && !reduceMotion()) {
    b.animate(
      [{ transform: "scale(1)" }, { transform: "scale(.9)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
      { duration: 340, easing: EASE });
  }
  fadeSwap(document.querySelector("#ctInput .ct-row"), () => { ctShowSub(); ctShowPanels(ctSub); }, 0);
  fadeSwap($("heroTitle"), () => { $("heroTitle").textContent = CT_SUB[ctSub].title; }, 0);
  fadeSwap($("heroSub"), () => { $("heroSub").textContent = CT_SUB[ctSub].sub; }, 60);
};
["ctUrl", "ctUrl2"].forEach((id) => {
  $(id).addEventListener("input", ctSetBtn);
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("ctGo").click(); } });
});

function ctPanels(sub) {                                 // sirf us tab ka result dikhe
  $("ctVideo").classList.toggle("hidden", sub !== "tags");
  ["ctBody", "cmpBody", "planBody"].forEach(id => $(id).classList.add("hidden"));
}
function ctShowLoading(id) {                             // thumbnail shows instantly, text is shimmer
  const img = $("ctThumbImg");
  img.classList.remove("bad");
  img.onerror = () => img.classList.add("bad");
  img.src = ctYtThumb(id);
  $("ctThumb").href = "https://www.youtube.com/watch?v=" + id;
  $("ctVideo").classList.add("loading");
  ["ctVTitle", "ctChan", "ctWhen"].forEach(k => { $(k).textContent = ""; });
  $("ctStats").innerHTML = '<div class="ct-stat ct-sk"></div>'.repeat(4);
  $("ctDl").disabled = true; ctThumbUrl = "";
  $("ctBody").classList.add("hidden");
  $("ctResults").classList.remove("hidden");
}

$("ctGo").onclick = async () => {
  if (ctBusy) return;
  if (!currentUser) { $("loginModal").classList.remove("hidden"); $("modalOk").focus(); return; }
  const sub = ctSub, key = ctKey();
  if (!key) return showError(sub === "" ? "Please paste both YouTube video links." : sub === "tags" ? "Please paste a valid YouTube video link." : "Please paste a valid YouTube channel link or @handle.");
  if (key === ctLastId) return;
  if (sub === "" && key.split("|")[0] === key.split("|")[1]) return showError("Both links are the same video. Paste your competitor's video in the second box.");
  hideError();
  const tok = ++ctTok;
  ctLastId = null; ctDone = false; ctBusy = true; ctSetBtn();
  ctPanels(sub);
  if (sub === "tags") ctShowLoading(key); else $("ctResults").classList.add("hidden");
  try {
    if (sub === "tags") {
      const d = await api("yt", { id: key });
      if (tok !== ctTok) return;
      renderCT(d);
    } else if (sub === "") {
      const [a, b] = key.split("|");
      const d = await api("cmp", { a, b });
      if (tok !== ctTok) return;
      renderCmp(d);
    } else {
      const d = await api("plan", { q: key });
      if (tok !== ctTok) return;
      renderPlan(d);
    }
    ctLastId = key;
  } catch (e) {
    if (tok !== ctTok) return;
    log.error("CT fetch:", e);
    ctDone = false;
    $("ctResults").classList.add("hidden");
    showError(e.safe ? e.message : "Couldn't fetch this. Please try again.");
  } finally {
    if (tok === ctTok) { ctBusy = false; ctSetBtn(); }
  }
};

/* ---- Competitor compare result ---- */
const lc = (t) => String(t).trim().toLowerCase();
function renderCmp(d) {
  const you = d.you || {}, rv = d.rival || {}, yt = you.tags || [], rt = rv.tags || [];
  const ys = new Set(yt.map(lc)), rs = new Set(rt.map(lc));
  const missing = rt.filter(t => !ys.has(lc(t)));
  const common = rt.filter(t => ys.has(lc(t)));
  const mine = yt.filter(t => !rs.has(lc(t)));

  $("cmpMsg").textContent = !rt.length ? "Your competitor's video has no public tags."
    : missing.length ? `Your competitor has ${missing.length} tag${missing.length === 1 ? "" : "s"} that you don't have.`
    : "You already use every tag your competitor uses.";
  $("cmpSub").textContent = `You: ${you.title || "your video"} (${yt.length} tags) · Competitor: ${rv.title || "competitor video"} (${rt.length} tags)`;

  $("cmpMiss").value = missing.join(", ");
  $("cmpMissInfo").textContent = missing.length + " tags";
  renderChips($("cmpMissChips"), missing);
  renderChips($("cmpCommonChips"), common);
  renderChips($("cmpMineChips"), mine);
  $("cmpMissBox").classList.toggle("hidden", !missing.length);
  $("cmpCommonBox").classList.toggle("hidden", !common.length);
  $("cmpMineBox").classList.toggle("hidden", !mine.length);

  $("cmpBody").classList.remove("hidden");
  $("ctResults").classList.remove("hidden");
  ctDone = true;
}

/* ---- Channel Planner result ---- */
function renderPlan(d) {
  const ch = d.channel || {}, days = d.days || [], top = d.topUploadDay, best = d.bestDay;
  $("planInfo").textContent = d.count ? `${ch.title || "Channel"} · last ${d.count} videos` : "";
  $("planMsg").textContent = !d.count ? "No public videos found on this channel."
    : top && best && top !== best ? `You mostly upload on ${top}, but your ${best} videos get the most views.`
    : top ? `You mostly upload on ${top}, and those videos also do best. Keep it up!`
    : "Not enough data to find a pattern yet.";
  $("planTip").textContent = d.count && best ? `Try posting your next video on ${best}` + (d.hour ? ` around ${d.hour}.` : ".") : "";
  const ul = $("planDays"); ul.innerHTML = "";
  days.forEach((x) => {
    const li = document.createElement("li");
    if (x.full === best) li.className = "best";
    const s = document.createElement("span"); s.textContent = x.full;
    const b = document.createElement("b");
    b.textContent = `${x.count} video${x.count === 1 ? "" : "s"} · avg ${x.avg || "0"} views` + (x.full === best ? " · best day" : "") + (x.full === top ? " · most uploads" : "");
    li.append(s, b); ul.appendChild(li);
  });
  $("planBody").classList.remove("hidden");
  $("ctResults").classList.remove("hidden");
  ctDone = true;
}
let ctThumbUrl = "";
$("ctDl").onclick = async () => {                        // thumbnail download (agar browser rokta hai to nayi tab mein khulti hai)
  if (!ctThumbUrl) return;
  try {
    const r = await fetch(ctThumbUrl);
    if (!r.ok) throw new Error("x");
    const blob = await r.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "thumbnail.jpg";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (_) {
    window.open(ctThumbUrl, "_blank", "noopener");
    toast("Image opened. Long-press or right-click to save.");
  }
};

function renderCT(d) {
  const v = d.video || {}, ch = d.channel || {};
  $("ctVideo").classList.remove("loading");
  $("ctVTitle").textContent = v.title || "";
  $("ctChan").textContent = ch.title || "";
  const w = ctWhen(v.publishedAt);
  $("ctWhen").textContent = [v.views && v.views + " views", w && "Uploaded " + w].filter(Boolean).join(" · ");

  const st = $("ctStats"); st.innerHTML = "";
  ctStatList(v).forEach(([k, val]) => {
    const t = document.createElement("div"); t.className = "ct-stat";
    const b = document.createElement("b"); b.textContent = val;
    const s = document.createElement("span"); s.textContent = k;
    t.append(b, s); st.appendChild(t);
  });

  ctThumbUrl = v.thumb || "";
  $("ctDl").disabled = !ctThumbUrl;

  const info = $("ctInfo"); info.innerHTML = "";
  ctMoreList(v, ch).forEach(([k, val]) => {
    const li = document.createElement("li");
    const s = document.createElement("span"); s.textContent = k;
    const b = document.createElement("b"); b.textContent = val;
    li.append(s, b); info.appendChild(li);
  });

  const tags = v.tags || [];
  $("ctTags").value = tags.join(", ");
  renderChips($("ctTagChips"), tags);
  $("ctTagInfo").textContent = tags.length ? tags.length + " tags, " + tags.join(", ").length + " characters" : "no tags on this video";

  const desc = v.description || "";
  $("ctDesc").value = desc;
  $("ctDescInfo").textContent = desc.length + " chars";
  $("ctBody").classList.remove("hidden");
  ctDone = true;                                         // result ab mode badalne par bhi yaad rahega
}

/* ---------- First 10 seconds only (Suggestion mode) ----------
   The browser plays the first 10 seconds and records them (video + sound) into a small file.
   Only that small file is uploaded. Needs a modern browser with MediaRecorder. */
function clipFail(why) {
  log.warn("Clip failed:", why);
  const e = new Error("We couldn't process this video in your browser.");
  e.safe = true;
  return e;
}
const waitEv = (el, ev, ms) => new Promise((res) => {
  const t = setTimeout(res, ms);
  el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
});

async function clipStart(file, secs) {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) throw clipFail("unsupported");
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = AC ? new AC() : null;                       // created inside the tap so phones allow sound capture
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.src = url;
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none";
  document.body.appendChild(v);
  let stream = null, stop = false;
  try {
    let audioTrack = null;
    if (ac) {
      ac.resume().catch(() => {});
      const node = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination();
      node.connect(dest);                                // sound goes to the recorder only, nothing plays on the speakers
      audioTrack = dest.stream.getAudioTracks()[0] || null;
    }
    const unlock = v.play().then(() => v.pause()).catch(() => {});   // started inside the tap, so mobile browsers allow the real play later
    await new Promise((res, rej) => {
      v.onloadedmetadata = res; v.onerror = () => rej(new Error("decode"));
      setTimeout(() => rej(new Error("timeout")), 10000);
    });
    await unlock;
    if (v.currentTime > 0.05) { v.currentTime = 0; await waitEv(v, "seeked", 1500); }

    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) throw new Error("no video track");
    const sc = Math.min(1, 720 / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * sc / 2) * 2), h = Math.max(2, Math.round(vh * sc / 2) * 2);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);
    stream = cv.captureStream(30);
    if (audioTrack) stream.addTrack(audioTrack);

    const mime = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
      .find((t) => MediaRecorder.isTypeSupported(t)) || "";
    const rec = new MediaRecorder(stream, mime
      ? { mimeType: mime, videoBitsPerSecond: 1200000, audioBitsPerSecond: 96000 }
      : { videoBitsPerSecond: 1200000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    const draw = () => {
      if (stop) return;
      ctx.drawImage(v, 0, 0, w, h);
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
    };
    draw();
    rec.start(250);
    await v.play();
    await new Promise((res, rej) => {                    // record until 10 seconds are done (or the video ends)
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (v.currentTime >= secs || v.ended) { clearInterval(iv); res(); }
        else if (performance.now() - t0 > (secs + 8) * 1000) { clearInterval(iv); rej(new Error("stalled")); }
      }, 100);
      v.onerror = () => { clearInterval(iv); rej(new Error("decode")); };
    });
    stop = true; v.pause();
    if (rec.state !== "inactive") rec.stop();
    await stopped;

    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    const blob = new Blob(chunks, { type });
    if (blob.size < 3000) throw new Error("empty recording");
    log.info("First 10 seconds ready:", type, (blob.size / 1048576).toFixed(2) + " MB");
    return new File([blob], "hook-first-10s." + (type.includes("mp4") ? "mp4" : "webm"), { type });
  } catch (e) {
    throw e.safe ? e : clipFail(e && e.message);
  } finally {
    stop = true;
    try { v.pause(); } catch (_) {}
    v.remove(); URL.revokeObjectURL(url);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ac) ac.close().catch(() => {});
  }
}

/* ---------- Gemini (via Cloudflare Worker) ---------- */
const CHUNK = 16 * 1024 * 1024;   // 8 MB ka multiple hona zaroori hai (Worker bhi yahi maanta hai)

/* Attempt note: "Second attempt…" / "Third attempt…" (pehli baar kuch nahi dikhta) */
function tryNote(a) {
  let el = $("tryNote");
  if (!el) {
    el = document.createElement("p");
    el.id = "tryNote"; el.className = "try-note hidden";
    document.querySelector("#skel .loader-card").appendChild(el);
  }
  if (a > 1) { el.textContent = (a === 2 ? "Second" : "Third") + " attempt…"; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}
/* Retry sirf Gemini wale steps (upload start, chunk) par aur sirf jab Worker ne 502 diya.
   Internet band, coins khatam, file badi: retry nahi. Har step ko max 3 koshish. */
const canRetry = (e) => !!e && !e.offline && !e.safe && e.status === 502 && (e.stage === "start" || e.stage === "chunk");

async function withTries(step) {
  for (let a = 1; ; a++) {
    if (!navigator.onLine) throw netErr();               // data band hai to koshish hi mat karo
    tryNote(a);                                          // 1 = kuch nahi, 2 = "Second attempt…", 3 = "Third attempt…"
    try {
      const r = await step();
      tryNote(1);
      return r;
    } catch (e) {
      log.warn("Attempt " + a + " failed:", e && e.message);
      if (a >= 3 || !canRetry(e)) { tryNote(1); throw e; }
      await sleep(1200 * a);
    }
  }
}

async function sendChunk(uploadId, file, offset, end) {
  let token, res;
  try { token = await currentUser.getIdToken(); }
  catch (e) { throw isNetFail(e) ? netErr() : e; }
  try {
    res = await fetch(`${API_URL}?action=chunk&id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream" },
      body: file.slice(offset, end)
    });
  } catch (e) { throw netErr(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Upload failed " + res.status);
    e.safe = res.status >= 400 && res.status < 500;
    e.status = res.status; e.stage = "chunk";
    throw e;
  }
  return data;
}

async function analyzeWithGemini(file, m = "tags") {
  log.info("Requesting upload...");
  const { uploadId } = await withTries(() => api("start", { name: file.name, size: file.size, mime: file.type || "video/mp4", mode: m }));

  log.info("Uploading video in chunks...");
  let fileName = null;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, file.size), last = end >= file.size;
    const data = await withTries(() => sendChunk(uploadId, file, offset, end));
    if (last) fileName = data.file;
    log.info(`Uploaded ${Math.round(end / file.size * 100)}%`);
  }

  log.info("Analyzing...");
  if (m === "hook") { setSteps(2); clearTimeout(stepTimer); stepTimer = setTimeout(() => setSteps(3), 6000); }
  return await api("analyze", { file: fileName });
}

async function analyzeHook(file) {
  const clip = await clipStart(file, HOOK_SECS);         // only the first 10 seconds leave the phone/computer
  setSteps(1);
  thumbPromise = captureFrames(file);         // fills the filmstrip while the small file uploads
  return await analyzeWithGemini(clip, "hook");
}

/* ---------- Results ---------- */
const clean = (arr, n) => [...new Set((arr || []).map(s => String(s).trim()).filter(Boolean))].slice(0, n);

function normalize(d) {
  return {
    tags: clean(d.tags, 25).map(t => t.replace(/^#/, "")),
    hashtags: clean(d.hashtags, 30).map(h => "#" + h.replace(/^#+/, "").replace(/\s+/g, "")),
    keywords: clean(d.keywords, 30),
    titles: clean(d.titles, 5)
  };
}


/* ---------- Toast, SEO score, Copy all ---------- */
let toastT = null, lastRes = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

/* Local estimate (koi extra API call nahi): tags, hashtags, keywords aur titles ki quality */
function seoScore(r) {
  const tl = r.tags.join(", ").length;
  const longTail = r.tags.filter(t => t.trim().split(/\s+/).length >= 3).length;
  const goodTitles = r.titles.filter(t => t.length >= 30 && t.length <= 70).length;
  let s = 0;
  s += r.tags.length >= 10 ? 20 : r.tags.length * 2;
  s += tl >= 250 && tl <= 500 ? 15 : tl > 0 ? 7 : 0;
  s += longTail >= 3 ? 15 : longTail * 5;
  s += r.hashtags.length >= 15 ? 15 : r.hashtags.length;
  s += r.keywords.length >= 12 ? 15 : r.keywords.length;
  s += Math.round(20 * goodTitles / Math.max(1, r.titles.length));
  return Math.max(0, Math.min(100, Math.round(s)));
}
function countUp(el, to) {
  const t0 = performance.now(), dur = 900;
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(f);
  })(t0);
}
/* Ring + number animation, shared by the SEO score and the hook score */
function drawRing(fill, numEl, sc, greenAt, warnAt) {
  fill.style.transition = "none";
  fill.style.strokeDashoffset = "119.4";
  fill.getBoundingClientRect();                              // reflow, taaki animation phir se chale
  fill.style.transition = "";
  fill.style.stroke = sc >= greenAt ? "var(--green)" : sc >= warnAt ? "var(--warn)" : "var(--danger)";
  fill.style.strokeDashoffset = String(119.4 * (1 - sc / 100));
  countUp(numEl, sc);
}
function renderScore(r) {
  const sc = seoScore(r);
  drawRing($("ringFill"), $("scoreNum"), sc, 75, 50);
  $("scoreMsg").textContent = (sc >= 85 ? "Excellent, ready to publish." : sc >= 70 ? "Good, ready to use." : sc >= 50 ? "Fair, add your own keywords too." : "Low, try a clearer video.") + " Estimate based on your tags, hashtags and titles.";
}
$("copyAll").onclick = (e) => {
  if (!lastRes) return;
  const r = lastRes;
  copyText(["TITLES", ...r.titles, "", "TAGS", r.tags.join(", "), "", "HASHTAGS", r.hashtags.join(" "), "", "KEYWORDS", r.keywords.join(", ")].join("\n"), e.currentTarget);
};

function showResults(d) {
  const res = normalize(d);
  const { tags, hashtags, keywords, titles } = res;

  const tagStr = tags.join(", ");
  $("tags").value = tagStr;
  renderChips($("tagChips"), tags);
  $("tagsInfo").innerHTML = `${tags.length} tags, <span class="${tagStr.length > 500 ? "over500" : ""}">${tagStr.length}/500 characters</span>`;
  $("hashtags").value = hashtags.join(" ");
  $("hashInfo").textContent = hashtags.length + " hashtags";
  $("keywords").value = keywords.join(", ");
  $("kwInfo").textContent = keywords.length + " keywords";

  const ul = $("titles");
  ul.innerHTML = "";
  titles.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="t"></span><span class="row-r"><span class="n ${t.length <= 60 ? "good" : t.length <= 70 ? "ok" : "bad"}">${t.length} chars</span><button class="btn sm">Copy</button></span>`;
    li.querySelector(".t").textContent = t;
    li.querySelector("button").onclick = (e) => copyText(t, e.target);
    ul.appendChild(li);
  });
  $("results").classList.remove("hidden");
  lastRes = res; renderScore(res);
  tutOn("results");
  return res;
}

/* Suggestion mode: hook score + stronger hook lines */
function fillList(ul, items) {
  ul.innerHTML = "";
  (items || []).forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
}
function showHook(d) {
  const sc = Math.max(0, Math.min(100, Math.round(d.score || 0)));
  $("hookResults").classList.remove("hidden");
  drawRing($("hRingFill"), $("hScoreNum"), sc, 90, 70);
  $("hScoreMsg").textContent = d.good
    ? "Excellent hook. Viewers will keep watching, no changes needed."
    : sc >= 70 ? "Good, but it can be stronger. Try the lines below."
    : "Weak hook. Viewers may leave early. Use one of the lines below.";
  $("hVerdict").textContent = d.verdict || "";

  const note = !d.hasAudio ? "No audio detected at the start of your video. Add a voice hook or a strong on-screen text line."
    : !d.hasSpeech ? "Only music or sound, nobody speaks at the start of your video. Start with a spoken hook."
    : "";
  $("hNote").textContent = note;
  $("hNote").classList.toggle("hidden", !note);

  $("hLang").textContent = d.language ? "Language: " + d.language : "";
  $("hCurrent").textContent = d.currentHook || "No clear hook found in the first seconds.";
  fillList($("hGood"), d.strengths);
  fillList($("hBad"), d.weaknesses);

  const hooks = d.hooks || [];
  $("hSuggestBox").classList.toggle("hidden", !hooks.length);
  const ul = $("hHooks"); ul.innerHTML = "";
  hooks.forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="t"></span><span class="row-r"><span class="n"></span><button class="btn sm">Copy</button></span>';
    const t = li.querySelector(".t"); t.textContent = h.text;
    if (h.roman) { const r = document.createElement("small"); r.className = "roman"; r.textContent = h.roman; t.appendChild(r); }
    li.querySelector(".n").textContent = h.type || "";
    li.querySelector("button").onclick = (e) => copyText(h.text, e.target);
    ul.appendChild(li);
  });

  $("hTipsBox").classList.toggle("hidden", !(d.tips || []).length);
  fillList($("hTips"), d.tips);

  const tr = d.trending || [];
  $("hTrendBox").classList.toggle("hidden", !tr.length);
  renderChips($("hTrend"), tr);
}

async function writeClip(text) {                       // works on older mobile browsers too
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch (_) { return false; }
}

function renderChips(box, tags) {                      // tap a tag to copy just that one
  box.innerHTML = "";
  tags.forEach(t => {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = t;
    b.onclick = async () => { const ok = await writeClip(t); b.classList.add("done"); toast(ok ? "Copied \u2713" : "Couldn't copy"); };
    box.appendChild(b);
  });
}

async function copyText(text, btn) {
  if (btn && btn.dataset && btn.dataset.copy === "tags") tutOn("copied");
  const ok = await writeClip(text);
  toast(ok ? "Copied \u2713" : "Couldn't copy, please select and copy");
  const old = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = old), 1200);
}
document.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copyText($(b.dataset.copy).value, b));

/* ---------- Main flow ---------- */
let running = false;

$("go").onclick = async () => {
  if (running || !chosen) return;
  if (!currentUser) { log.info("Guest tried to analyze, login required"); $("loginModal").classList.remove("hidden"); $("modalOk").focus(); return; }
  const m = mode;                                        // the mode is locked for this run
  if (coin.left != null && coin.left < COST[m]) {
    showError(`Not enough coins. You need ${COST[m]} but have ${coin.left}. Coins refill every day.`);
    return;
  }
  running = true;
  hideError();
  setUI("running");
  if (m === "hook") tutHide(); else tutOn("analyze");
  $("results").classList.add("hidden");
  $("hookResults").classList.add("hidden");
  startSkeleton(m);

  const file = chosen;

  // Worker does everything: coins, upload check, analysis, history save and analytics log
  const ai = await (m === "hook" ? analyzeHook(file) : analyzeWithGemini(file, "tags"))
    .then(d => {
      if (m === "hook") log.info("Hook score:", d.score, "| sources found: YouTube", d.stats && d.stats.yt, "Google", d.stats && d.stats.google, "DuckDuckGo", d.stats && d.stats.ddg, "Reddit", d.stats && d.stats.reddit, "| hooks written:", d.stats && d.stats.hooks);
      else log.info("Analysis complete. Gemini tags:", d.stats && d.stats.gemini, "| YouTube suggestions found:", d.stats && d.stats.yt, "| used in final tags:", d.stats && d.stats.ytUsed);
      return { data: d };
    })
    .catch(e => { log.error(e); return { error: e.message, safe: e.safe }; });

  const thumb = ai.error ? null : await Promise.race([thumbPromise, sleep(2500).then(() => null)]);
  stopSkeleton();
  if (ai.error) {
    showError(ai.safe ? ai.error : "We couldn't analyze this video. Please try again.");
    if (m === "tags") tutOn("failed");
    refreshCoins();                                      // a failed run is refunded, show the real balance
  } else {
    if (typeof ai.data.coins === "number") renderCoins(ai.data.coins, ai.data.max);
        if (m === "hook") showHook(ai.data); else showResults(ai.data);
    if (ai.data.hid && thumb) sendThumb(ai.data.hid, thumb).catch(e => log.warn("Thumb save failed:", e));
  }

  running = false;
    if (!ai.error) modeDone[m] = true;                     // is mode ka result ab yaad rahega
    setUIAnimated(ai.error ? "ready" : "done");
};

async function sendThumb(hid, blob) {                   // preview image for History; Worker validates it
  await api("thumb", { hid, thumbData: await blobToDataUrl(blob) });
}

/* ---------- Video Prompt: video and/or idea -> scene-by-scene AI video prompts (coins: 6) ---------- */
const PM_MAX = 100 * 1048576;                            // Worker ke PROMPT_MAX_MB (default 100) se match hona chahiye
let pmVideo = null, pmFormat = "tall", pmLast = null;
let pmSecs = 8;
$("pBtn").onclick = () => {
  if (running || switching) return;
  switching = true;
  applyMode(mode === "prompt" ? "tags" : "prompt", true).then(() => { switching = false; });
};

function pmBtn() {                                       // button tabhi khule jab video ya idea (5+ letters) ho
  $("pmGo").disabled = running || !(pmVideo || $("pmDesc").value.trim().length >= 5);
}
function pmRefresh() {
  const has = !!pmVideo;
  $("pmFname").classList.add("hidden");
  $("pmClear").classList.toggle("hidden", !has);
    $("pmPick").innerHTML = has ? '<i class="fa-solid fa-circle-check"></i> Video added · Change' : '<i class="fa-solid fa-video"></i> Add a video (optional)';
  pmBtn();
}
function pmSetVideo(f) {
  if (running || !f) return;
  hideError();
  if (!f.type.startsWith("video")) return showError("Please choose a video file.");
  if (f.size > PM_MAX) return showError(`This video is too large. For Video Prompt the maximum size is ${Math.round(PM_MAX / 1048576)} MB.`);
  pmVideo = f;
  pmRefresh();
}
$("pmPick").onclick = () => $("pmFile").click();
$("pmFile").onchange = (e) => { pmSetVideo(e.target.files[0]); e.target.value = ""; };
$("pmClear").onclick = () => { if (running) return; pmVideo = null; pmRefresh(); };
$("pmDesc").addEventListener("input", pmBtn);
["dragover", "dragenter"].forEach(ev => $("pmInput").addEventListener(ev, (e) => { e.preventDefault(); $("pmInput").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("pmInput").addEventListener(ev, (e) => { e.preventDefault(); $("pmInput").classList.remove("over"); }));
$("pmInput").addEventListener("drop", (e) => pmSetVideo(e.dataTransfer.files[0]));
$("pmFmt").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  pmFormat = b.dataset.f;
  document.querySelectorAll("#pmFmt button").forEach(x => x.classList.toggle("on", x === b));
};
$("pmDur").onclick = (e) => {                            // 8 ya 10 sec button
  const b = e.target.closest("button"); if (!b) return;
  pmSecs = +b.dataset.s;
  $("pmSecs").value = ""; $("pmSecs").classList.remove("on");
  document.querySelectorAll("#pmDur button").forEach(x => x.classList.toggle("on", x === b));
};
$("pmSecs").addEventListener("input", () => {            // custom: sirf number
  const el = $("pmSecs");
  el.value = el.value.replace(/\D/g, "").slice(0, 2);
  const btns = document.querySelectorAll("#pmDur button");
  if (!el.value) {                                       // khali kiya to wapas 8 sec
    pmSecs = 8; el.classList.remove("on");
    btns.forEach(x => x.classList.toggle("on", x.dataset.s === "8"));
    return;
  }
  pmSecs = +el.value; el.classList.add("on");
  btns.forEach(x => x.classList.remove("on"));
});
/* Video upload (start + chunks, 3 koshish tak) aur file ka naam wapas */
async function pmUpload(file) {
  const { uploadId } = await withTries(() => api("start", { name: file.name, size: file.size, mime: file.type || "video/mp4", mode: "prompt" }));
  let fileName = null;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, file.size), last = end >= file.size;
    const data = await withTries(() => sendChunk(uploadId, file, offset, end));
    if (last) fileName = data.file;
    log.info(`Prompt video uploaded ${Math.round(end / file.size * 100)}%`);
  }
  return fileName;
}

$("pmGo").onclick = async () => {
  if (running) return;
  if (!currentUser) { $("loginModal").classList.remove("hidden"); $("modalOk").focus(); return; }
    const desc = $("pmDesc").value.trim(), file = pmVideo, fmt = pmFormat, secs = pmSecs;
  if (secs < 3 || secs > 20) return showError("Scene length must be between 3 and 20 seconds.");
  if (!file && desc.length < 5) return showError("Add a video or describe your idea first.");
  if (coin.left != null && coin.left < COST.prompt) {
    showError(`Not enough coins. You need ${COST.prompt} but have ${coin.left}. Coins refill every day.`);
    return;
  }
  running = true;
  hideError();
  ["modeBtn", "ctBtn", "pBtn", "pmGo"].forEach(id => { $(id).disabled = true; });
  $("pmResults").classList.add("hidden");
  modeDone.prompt = false;
  startSkeleton(file ? "promptV" : "promptT");
  $("skel").classList.toggle("nostrip", !file);          // sirf idea ho to video-frames wali patti nahi

  let out;
  try {
    const fileName = file ? await pmUpload(file) : null;
    if (file) { setSteps(2); clearInterval(stepTimer); stepTimer = setInterval(() => setSteps(3), 4000); }
    out = { data: await api("pmake", { file: fileName, desc, fmt, secs }) };
  } catch (e) { log.error(e); out = { error: e.message, safe: e.safe }; }

  const thumb = out.error ? null : await Promise.race([thumbPromise, sleep(2500).then(() => null)]);
  stopSkeleton();
  $("skel").classList.remove("nostrip");
  if (out.error) {
    showError(out.safe ? out.error : "We couldn't make your prompt. Please try again.");
    refreshCoins();                                      // fail hua to coins wapas, asli balance dikhao
  } else {
    if (typeof out.data.coins === "number") renderCoins(out.data.coins, out.data.max);
    renderPm(out.data);
    modeDone.prompt = true;
    if (out.data.hid && thumb) sendThumb(out.data.hid, thumb).catch(e => log.warn("Thumb save failed:", e));
  }
  running = false;
  ["modeBtn", "ctBtn", "pBtn"].forEach(id => { $(id).disabled = false; });
  pmBtn();
};

function pmRow(label, text) {                            // ek label + Copy button + text block
  const row = document.createElement("div"); row.className = "pm-row";
  const head = document.createElement("div"); head.className = "pm-rh";
  const l = document.createElement("span"); l.className = "pm-lbl"; l.textContent = label;
  const cb = document.createElement("button"); cb.className = "btn sm ghost"; cb.textContent = "Copy";
  cb.onclick = (e) => copyText(text, e.currentTarget);
  head.append(l, cb);
  const p = document.createElement("p"); p.className = "pm-code"; p.textContent = text;
  row.append(head, p);
  return row;
}

function renderPm(d) {
  pmLast = d;
  const sc = d.scenes || [], total = sc.reduce((a, s) => a + (s.seconds || 0), 0);
  $("pmTitle").textContent = d.title || "Your video plan";
  $("pmMeta").textContent = `${sc.length} scenes, about ${total}s, ${d.fmt === "wide" ? "16:9" : "9:16"}`;
  $("pmSummary").textContent = d.summary || "";

  const notes = d.videoNotes || [];
  $("pmSeenBox").classList.toggle("hidden", !notes.length);
  fillList($("pmSeen"), notes);

  $("pmSceneInfo").textContent = d.language ? "Language: " + d.language : "";
  const box = $("pmScenes"); box.innerHTML = "";
  sc.forEach((s, i) => {
    const card = document.createElement("div"); card.className = "pm-scene";
    const h = document.createElement("div"); h.className = "pm-sh";
    const b = document.createElement("b"); b.textContent = "Scene " + (i + 1) + (s.title ? " \u00B7 " + s.title : "");
    const n = document.createElement("span"); n.className = "pm-sec"; n.textContent = (s.seconds || 5) + "s";
    h.append(b, n); card.appendChild(h);
    if (s.explain) { const p = document.createElement("p"); p.className = "pm-ex"; p.textContent = s.explain; card.appendChild(p); }
        const need = [s.placeName && "Place: " + s.placeName, (s.props || []).length && "Items: " + s.props.join(", ")].filter(Boolean).join("  |  ");
    if (need) { const p = document.createElement("p"); p.className = "pm-ex"; p.textContent = need; card.appendChild(p); }
   
    card.appendChild(pmRow("Prompt", s.prompt));
    box.appendChild(card);
  });



  $("pmSheet").value = d.sheet || "";
  $("pmSheetBox").classList.toggle("hidden", !d.sheet);
 $("pmGuide").classList.toggle("hidden", !d.sheet);
  $("pmAvoid").value = d.avoid || "";
  $("pmAvoidBox").classList.toggle("hidden", !d.avoid);
  $("pmTipsBox").classList.toggle("hidden", !(d.tips || []).length);
  fillList($("pmTips"), d.tips);
  $("pmResults").classList.remove("hidden");
}

$("pmCopyAll").onclick = (e) => {
  if (!pmLast) return;
  const t = (pmLast.scenes || []).map((s, i) =>
    `SCENE ${i + 1} (${s.seconds || 5}s)${s.title ? " - " + s.title : ""}\n${s.prompt}` + (s.voice ? `\nVoiceover: ${s.voice}` : "")
  ).join("\n\n");
  copyText(t, e.currentTarget);
};
pmRefresh();
/* ---------- Polish: scroll reveal, footer year, loading state ---------- */
$("yr").textContent = new Date().getFullYear();
document.querySelectorAll(".maxmb").forEach(e => e.textContent = MAX_MB);   // size limit page par config.js se aati hai
const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
  es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
}, { threshold: 0.15 }) : null;
document.querySelectorAll(".rv").forEach((el, i) => {
  el.style.transitionDelay = (i % 3) * 80 + "ms";
  io ? io.observe(el) : el.classList.add("in");
});


/* ---------- Skeleton loader + low-end mode ---------- */
const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2 ||
  window.matchMedia("(max-width: 600px)").matches;
if (lowEnd) document.documentElement.classList.add("lite");
log.info("Performance mode:", lowEnd ? "lite" : "full");

let stepTimer = null, capToken = 0;

/* Grab 6 real frames from the user's video for the filmstrip (limitSec = only look at the first seconds) */
let thumbPromise = Promise.resolve(null);
async function captureFrames(file, limitSec) {
  let thumb = null;
  const token = ++capToken;
  const frames = document.querySelectorAll("#skel .fr");
  frames.forEach(f => f.style.backgroundImage = "");
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; setTimeout(rej, 5000); });
    const span = limitSec ? Math.min(v.duration || 1, limitSec) : (v.duration || 1);
    const cv = document.createElement("canvas"); cv.width = 160; cv.height = 100;
    const ctx = cv.getContext("2d");
    for (let i = 0; i < frames.length; i++) {
      if (token !== capToken) return null;
      v.currentTime = span * (i + 0.5) / frames.length;
      await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
      const s = Math.max(160 / v.videoWidth, 100 / v.videoHeight);
      ctx.drawImage(v, (160 - v.videoWidth * s) / 2, (100 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
      if (token === capToken) frames[i].style.backgroundImage = `url(${cv.toDataURL("image/jpeg", 0.6)})`;
      if (i === 2) {                                   // larger frame saved to History
        const tc = document.createElement("canvas"); tc.width = 320; tc.height = 180;
        const k = Math.max(320 / v.videoWidth, 180 / v.videoHeight);
        tc.getContext("2d").drawImage(v, (320 - v.videoWidth * k) / 2, (180 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
        thumb = await new Promise(r => tc.toBlob(r, "image/jpeg", 0.7));
      }
    }
  } catch (e) { log.warn("Frame preview skipped:", e); }
  finally { URL.revokeObjectURL(url); }
  return thumb;
}

function buildWave() {
  const w = $("wave");
  if (w.children.length) return;
  const n = lowEnd ? 20 : 30;
  for (let i = 0; i < n; i++) {
    const b = document.createElement("i");
    b.style.setProperty("--d", (Math.random() * -1).toFixed(2) + "s");
    b.style.setProperty("--h", (0.35 + Math.random() * 0.65).toFixed(2));
    w.appendChild(b);
  }
}

function setSteps(active) {
  document.querySelectorAll("#ls li").forEach((li, i) => {
    li.className = i < active ? "done" : i === active ? "run" : "";
  });
}

const SKEL_TXT = {
  tags: ["Reading your video", "Watching every scene", "Listening to the audio", "Writing tags and titles"],
    hook: ["Reading your video", "Checking your hook", "Finding trending ideas", "Writing stronger hooks"],
  promptV: ["Reading your idea", "Watching your video", "Writing the script", "Building scene prompts"],
  promptT: ["Reading your idea", "Planning the story", "Writing the script", "Building scene prompts"]
};
function startSkeleton(m = "tags") {
  let i = 0;
  buildWave();
  document.querySelectorAll("#ls li").forEach((li, k) => { li.lastChild.textContent = SKEL_TXT[m][k]; });
  setSteps(0);
  $("skel").classList.remove("hidden");
  $("skel").scrollIntoView({ behavior: lowEnd ? "auto" : "smooth", block: "nearest" });
  clearInterval(stepTimer); clearTimeout(stepTimer);
    if (m === "tags" || m === "promptV" || m === "promptT") {
    const src = m === "tags" ? chosen : m === "promptV" ? pmVideo : null;
    thumbPromise = src ? captureFrames(src) : Promise.resolve(null);
    stepTimer = setInterval(() => { i = Math.min(i + 1, 3); setSteps(i); }, 5000);
  } else {
    thumbPromise = Promise.resolve(null);                // hook mode moves the steps itself (see analyzeHook)
  }
}
function stopSkeleton() {
  if (typeof tryNote === "function") tryNote(0);
  clearInterval(stepTimer); clearTimeout(stepTimer);
  capToken++;
  $("skel").classList.add("hidden");
}


/* ---------- Feedback: users can share problems (saved + rate limited by the Worker) ---------- */
let fbType = "problem";
function openFb() {
  if (!currentUser) return;
  $("fbBody").classList.remove("hidden"); $("fbDone").classList.add("hidden");
  $("fbErr").textContent = "";
  $("fbModal").classList.remove("hidden");
  setTimeout(() => $("fbMsg").focus(), 60);
}
function closeFb() { $("fbModal").classList.add("hidden"); }
$("fbOpen").onclick = openFb;
$("fbLink").onclick = (e) => { e.preventDefault(); openFb(); };
$("fbClose").onclick = closeFb;
$("fbOk").onclick = closeFb;
$("fbModal").addEventListener("mousedown", (e) => { if (e.target === $("fbModal")) closeFb(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFb(); });
$("fbMsg").oninput = () => { $("fbCount").textContent = $("fbMsg").value.length; };
$("fbType").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  fbType = b.dataset.t;
  document.querySelectorAll("#fbType button").forEach(x => x.classList.toggle("on", x === b));
};

$("fbSend").onclick = async () => {
  const msg = $("fbMsg").value.trim();
  $("fbErr").textContent = "";
  if ($("fbHp").value) return;                       // bot trap
  if (msg.length < 10) { $("fbErr").textContent = "Please write at least 10 characters."; return; }
  if (!currentUser) return;

  $("fbSend").disabled = true;
  try {
    await api("feedback", { type: fbType, message: msg, page: location.href });
    log.info("Feedback sent:", fbType);
    $("fbMsg").value = ""; $("fbCount").textContent = "0";
    $("fbBody").classList.add("hidden"); $("fbDone").classList.remove("hidden");
  } catch (e) {
    log.error("Feedback failed:", e);
    $("fbErr").textContent = e.safe ? e.message : "Couldn't send your message. Please try again.";
  } finally { $("fbSend").disabled = false; }
};


/* ---------- Side menu ---------- */
function setDrawer(open) {
  $("drawer").classList.toggle("open", open);
  $("scrim").classList.toggle("open", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
  if (open) refreshCoins();                          // always show the latest balance when the menu opens
}
$("menuBtn").onclick = () => setDrawer(true);
$("drawerClose").onclick = () => setDrawer(false);
$("scrim").onclick = () => setDrawer(false);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
$("navHistory").onclick = () => { setDrawer(false); showHistory(); };
$("hBack").onclick = showHome;

/* ---------- History (kept 7 days, then deleted from Firebase) ---------- */
/* The Worker writes history items. The browser can only read and delete the user's own items. */
const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

async function removeHistoryItem(uid, id) {
  await firebase.database().ref(`history/${uid}/${id}`).remove();
}

/* Expired items delete karne ke liye sirf expiresAt padhte hain (shallow-ish: poora data nahi, query se). */
async function sweepHistory(uid) {
  try {
    const snap = await firebase.database().ref("history/" + uid)
      .orderByChild("expiresAt").endAt(Date.now()).once("value");
    const jobs = [];
    snap.forEach(c => { jobs.push(removeHistoryItem(uid, c.key)); });
    if (jobs.length) { await Promise.all(jobs); log.info("Deleted expired history items:", jobs.length); }
  } catch (e) { log.warn("History sweep:", e); }
}

/* ---- Lazy loading: pehle 4, phir scroll karne par agle 4 (skeleton ke saath) ---- */
const HIST_PAGE = 4;
const H = { token: 0, filter: "tags", loading: false, more: false, cursor: null, obs: null, sentinel: null };
/* History filter: All | Tags (purane items mein type nahi hota) | Suggestion | Tag Finder */
const histMatch = (it) => H.filter === "tags" ? !it.type : it.type === H.filter;
const HIST_EMPTY = {
  tags: "No Analyze history yet. Analyze a video and it will appear here.",
  hook: "No Suggestion history yet.", ct: "No Tag Finder history yet.", cmp: "No Competitor history yet.", pm: "No Video Prompt history yet."
};
$("hFilter").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.f === H.filter) return;
  H.filter = b.dataset.f;
  document.querySelectorAll("#hFilter button").forEach(x => x.classList.toggle("on", x === b));
  loadHistory();
};

function histStop() {                                   // history se bahar jaate hi sab band
  H.token++; H.loading = false; H.more = false; H.cursor = null;
  if (H.obs) { H.obs.disconnect(); H.obs = null; }
}

function histSkeleton() {
  const el = document.createElement("article");
  el.className = "hc hc-skel";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<div class="hc-head"><span class="hc-thumb sk"></span><span class="hc-meta"><i class="sk-line w80"></i><i class="sk-line w50"></i></span></div>';
  return el;
}

function showHistory() {
  $("homeView").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("historyView").classList.remove("hidden");
  window.scrollTo(0, 0);
  loadHistory();
}

/* Sirf HIST_PAGE+1 items laata hai (extra wala agle page ka cursor banta hai) */
async function histFetch(uid, cursor) {
  let q = firebase.database().ref("history/" + uid).orderByChild("createdAt");
  if (cursor) q = q.endAt(cursor.createdAt, cursor.id);
  const snap = await q.limitToLast(HIST_PAGE + 1).once("value");
  const items = [];
  snap.forEach(c => { items.push({ id: c.key, ...c.val() }); });
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (a.id < b.id ? 1 : -1));
  const extra = items.length > HIST_PAGE ? items[HIST_PAGE] : null;
  return { page: items.slice(0, HIST_PAGE), extra };
}

async function loadHistory() {                          // fresh start
  histStop();
  const list = $("hList");
  list.innerHTML = "";
  H.sentinel = document.createElement("div");
  H.sentinel.className = "h-sentinel";
  list.appendChild(H.sentinel);
  H.more = true;
  await histLoadMore(true);
}

async function histLoadMore(first) {
  if (H.loading || !H.more || !currentUser) return;
  H.loading = true;
  const token = H.token, list = $("hList");
  if (H.obs) H.obs.unobserve(H.sentinel);

  const skels = Array.from({ length: HIST_PAGE }, histSkeleton);
  skels.forEach(s => list.insertBefore(s, H.sentinel));

  try {
    const now = Date.now(), shown = [];
    let cur = H.cursor;
    do {                                                // filter ke baad kam mile to agla page bhi laao
      const r = await histFetch(currentUser.uid, cur);
      if (token !== H.token) return;
      cur = r.extra ? { createdAt: r.extra.createdAt, id: r.extra.id } : null;
      r.page.forEach(it => { if ((it.expiresAt || 0) > now && histMatch(it)) shown.push(it); });
    } while (cur && shown.length < HIST_PAGE);

    skels.forEach(s => s.remove());
    shown.forEach((it, i) => {
      const c = histCard(it, now);
      c.style.animationDelay = i * 40 + "ms";
      list.insertBefore(c, H.sentinel);
    });
    H.cursor = cur;
    H.more = !!cur;
    if (first && !shown.length && !H.more) {
      list.insertBefore(histMsg(HIST_EMPTY[H.filter]), H.sentinel);
    }
    log.info(`History: ${shown.length} loaded, more =`, H.more);
  } catch (e) {
    if (token !== H.token) return;
    log.error("History load failed:", e);
    skels.forEach(s => s.remove());
    const m = histMsg(first ? "Couldn't load your history." : "Couldn't load more.");
    const rb = document.createElement("button");
    rb.className = "btn sm ghost"; rb.textContent = "Try again";
    rb.onclick = () => { m.remove(); H.more = true; histLoadMore(first); };
    m.appendChild(rb);
    list.insertBefore(m, H.sentinel);
    H.more = false;
  } finally {
    if (token === H.token) {
      H.loading = false;
      histWatch();
    }
  }
}
function histMsg(text) {
  const d = document.createElement("div");
  d.className = "empty";
  d.append(text);
  return d;
}

/* Sentinel dikhte hi agle 4 load (200px pehle se, taaki scroll rukta na lage) */
function histWatch() {
  if (!H.more || !H.sentinel) return;
  if (!("IntersectionObserver" in window)) { histLoadMore(false); return; }
  if (!H.obs) {
    H.obs = new IntersectionObserver((es) => {
      if (es.some(e => e.isIntersecting)) histLoadMore(false);
    }, { rootMargin: "200px 0px" });
  }
  H.obs.unobserve(H.sentinel);                          // re-observe: screen badi ho to bhi check dobara chale
  H.obs.observe(H.sentinel);
}

/* Card ka andar ka heavy part (textareas, chips) sirf pehli baar kholne par banta hai */
const ctHistDetails = (it) => [
  ["Title", it.title], ["Channel", it.channel], ["Subscribers", it.subs],
  ["Uploaded", ctWhen(it.publishedAt)], ["Views", it.views], ["Views / day", it.viewsPerDay],
  ["Viral score", it.viral], ["Type", it.kind], ["Duration", it.duration],
  ["Category", it.category], ["Topics", (it.topics || []).join(", ")], ["Quality", it.hd],
  ["Captions", it.captions], ["Made for kids", it.kids], ["Language", it.lang],
  ["Channel created", it.chCreated ? ctDay(it.chCreated) : ""], ["Channel videos", it.chVideos],
  ["Channel total views", it.chTotalViews], ["Channel country", it.country]
].filter(([, x]) => x).map(([k, x]) => k + ": " + x).join("\n");
function buildHistBody(it, body, art) {
        const sections = (it.type === "pm"
    ? [["Summary", it.summary || ""],
       ["Reference image prompt (make this image first)", it.sheet || ""],
       ["Scenes", (it.scenes || []).map((s, i) => "Scene " + (i + 1) + " (" + (s.seconds || 5) + "s)" + (s.title ? " - " + s.title : "") + "\n" + (s.explain ? s.explain + "\n" : "") + (s.voice ? "Voiceover: " + s.voice + "\n" : "") + "Prompt: " + (s.prompt || "")).join("\n\n")],
       ["Negative prompt", it.avoid || ""],
       ["Tips", (it.tips || []).join("\n")]]
    : it.type === "ct"
    ? [["Video details", ctHistDetails(it)], ["Tags", (it.tags || []).join(", ")], ["Description", it.description || ""]]
        : it.type === "cmp"
    ? [["Videos", "You: " + (it.title || "") + "\nCompetitor: " + (it.rivalTitle || "")],
       ["Tags you are missing", (it.missing || []).join(", ")],
       ["Tags you both use", (it.common || []).join(", ")],
       ["Only you use these", (it.mine || []).join(", ")]]
    : it.type === "hook"
    ? [["Score", (it.score || 0) + "/100" + (it.verdict ? "\n" + it.verdict : "")],
       ["Current hook", it.currentHook || "No clear hook found."],
       ["What works", (it.strengths || []).join("\n")],
       ["What to fix", (it.weaknesses || []).join("\n")],
       ["Stronger hook lines", (it.hooks || []).map((h) => h.text + (h.roman ? " (" + h.roman + ")" : "")).join("\n")],
       ["Tips", (it.tips || []).join("\n")]]
    : [["Tags", (it.tags || []).join(", ")], ["Hashtags", (it.hashtags || []).join(" ")],
       ["Keywords", (it.keywords || []).join(", ")], ["Titles", (it.titles || []).join("\n")]]
  ).filter(([, text]) => text);
  sections.forEach(([label, text]) => {
    const box = document.createElement("div"); box.className = "box";
    box.innerHTML = '<header><h3></h3><button class="btn sm ghost">Copy</button></header><textarea readonly></textarea>';
    box.querySelector("h3").textContent = label;
    box.querySelector("textarea").value = text;
    box.querySelector("button").onclick = (e) => copyText(text, e.target);
    if (label === "Tags") {
      const chips = document.createElement("div"); chips.className = "tagchips";
      renderChips(chips, it.tags || []);
      const hint = document.createElement("p"); hint.className = "chip-hint";
      hint.textContent = "Tap a tag to copy it one by one.";
      box.append(chips, hint);
    }
    body.appendChild(box);
  });
  const del = document.createElement("button"); del.className = "hc-del"; del.textContent = "Delete";
  del.onclick = async () => {
    if (!del.classList.contains("sure")) {
      del.classList.add("sure"); del.textContent = "Click again to confirm";
      setTimeout(() => { del.classList.remove("sure"); del.textContent = "Delete"; }, 3000);
      return;
    }
    try { await removeHistoryItem(currentUser.uid, it.id); art.remove(); log.info("History item deleted:", it.id); }
    catch (e) { log.error(e); }
  };
  body.appendChild(del);
}

function histCard(it, now) {
  const art = document.createElement("article"); art.className = "hc";
  const head = document.createElement("button"); head.className = "hc-head";
  const th = document.createElement("span"); th.className = "hc-thumb";
  const src = it.thumbData || it.thumbUrl;
  if (src) th.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
  const meta = document.createElement("span"); meta.className = "hc-meta";
  const days = Math.max(1, Math.ceil((it.expiresAt - now) / 86400000));
  const b = document.createElement("b");
b.textContent = it.type === "hook" ? "Hook check \u00B7 " + (it.score || 0) + "/100"
  : it.type === "pm" ? "Video Prompt \u00B7 " + (it.title || "Plan")
  : it.type === "cmp" ? "Competitor \u00B7 " + (it.title || "Video")
  : it.type === "ct" ? "Tag Finder \u00B7 " + (it.title || "Video")
  : (it.titles && it.titles[0]) || it.fileName || "Video";
  const sp = document.createElement("span");
  sp.textContent = new Date(it.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + " · Deletes in " + days + (days === 1 ? " day" : " days");
  meta.append(b, sp);
  const chev = document.createElement("i"); chev.className = "chev";
  head.append(th, meta, chev);

  const body = document.createElement("div"); body.className = "hc-body hidden";
  let built = false;
  head.onclick = () => {
    if (!built) { buildHistBody(it, body, art); built = true; }
    const open = body.classList.toggle("hidden") === false;
    art.classList.toggle("open", open);
  };
  art.append(head, body);
  return art;
}

/* ---------- First-time tutorial (hand pointer) ---------- */
const TUT = { step: 0, target: null, timer: null, user: null };
const tutKey = (u) => "trendly_tutorial_" + u.uid;

function maybeStartTutorial(user) {
  try { if (localStorage.getItem(tutKey(user))) return; } catch (_) {}
  const m = user.metadata || {};
  const first = m.creationTime && m.lastSignInTime && Math.abs(new Date(m.lastSignInTime) - new Date(m.creationTime)) < 60000;
  if (!first) return;                      // only for users logging in for the very first time
  TUT.user = user;
  log.info("Starting first-time tutorial");
  if (!chosen) tutGo(1);
}

/* Wait 1.5s before showing the hand so the page and buttons can settle into place */
function tutGo(step, delay = 1500) {
  TUT.step = step;
  tutHide(true);
  TUT.delayT = setTimeout(() => { if (TUT.step === step) tutShow(step); }, delay);
}
function tutShow(step) {
  const target = step === 4 ? $("googleBtn") : step === 1 ? $("pick") : step === 2 ? $("go") : document.querySelector('[data-copy="tags"]');
  if (!target) return;
  const text = step === 4 ? "Tap Continue with Google" : step === 1 ? "Tap here to choose your video" : step === 2 ? "Now tap Analyze video" : "Tap Copy to copy your tags";
  $("tut").classList.remove("no-hand");
  TUT.target = target; target.classList.add("tut-target");
  $("tutText").textContent = text;
  $("tut").classList.remove("hidden");
  target.scrollIntoView({ block: "center", behavior: lowEnd ? "auto" : "smooth" });
  clearInterval(TUT.timer);
  TUT.timer = setInterval(tutPlace, 300);
  setTimeout(tutPlace, 60);
}

/* The hand is positioned in page coordinates, so it scrolls natively with the page (no lag). */
function tutPlace() {
  const t = TUT.target, box = $("tut");
  const overlay = $("drawer").classList.contains("open") || !$("loginModal").classList.contains("hidden") || !$("fbModal").classList.contains("hidden");
  if (!t || !t.offsetParent || overlay) { box.style.visibility = "hidden"; return; }
  const r = t.getBoundingClientRect();
  const vx = r.left + r.width / 2;
  box.style.left = (vx + window.scrollX) + "px";
  box.style.top = (r.bottom + window.scrollY - 4) + "px";
  box.style.visibility = "visible";
  const bub = $("tutBubble"), w = bub.offsetWidth;
  const left = Math.min(Math.max(vx - w / 2, 8), innerWidth - 8 - w);   // keep bubble on screen, hand stays on the button
  bub.style.setProperty("--bx", (left - (vx - w / 2)) + "px");
}
function maybeStartLoginTutorial() {
  if (currentUser) return;                                  // only for visitors who are not logged in
  try { if (localStorage.getItem("trendly_login_tut")) return; } catch (_) {}
  log.info("Starting login tutorial");
  tutGo(4);
}
function tutHide(keepStep) {
  $("tut").classList.remove("no-hand");
  clearInterval(TUT.timer);
  clearTimeout(TUT.delayT);
  $("tut").classList.add("hidden");
  document.querySelectorAll(".tut-target").forEach(e => e.classList.remove("tut-target"));
  if (!keepStep) TUT.step = 0;
}
function tutFinish() {
  tutHide();
  if (TUT.user) { try { localStorage.setItem(tutKey(TUT.user), "1"); } catch (_) {} log.info("Tutorial finished"); }
}
function tutOn(evt) {
  if (!TUT.step) return;
  const s = TUT.step;
  if (evt === "gclick" && s === 4) {                         // Google popup is opening: hand away, hint stays
    clearTimeout(TUT.delayT); TUT.step = 45;
    $("tutText").textContent = "Now select your Gmail account";
    $("tut").classList.add("no-hand");
  }
  else if (evt === "gfail" && s === 45) tutGo(4, 800);       // popup closed without login: show the hand again
  else if (evt === "pick" && s === 1) tutHide(true);                       // file dialog open, wait for selection
  else if (evt === "selected" && s === 1) tutGo(2);
  else if (evt === "analyze" && s === 2) { tutHide(true); TUT.step = 25; }
  else if (evt === "failed" && s === 25) tutGo(2);
  else if (evt === "results" && (s === 25 || s === 2)) tutGo(3);
  else if (evt === "copied" && s === 3) tutFinish();
}
window.addEventListener("focus", () => setTimeout(() => { if (TUT.step === 1 && !chosen) tutGo(1, 600); }, 400)); // dialog cancelled


/* ---------- Analytics: browser only sends a visit ping; the Worker writes everything ---------- */
const getVid = () => { try { return localStorage.getItem("trendly_vid"); } catch (_) { return null; } };

async function trackVisit() {
  try {
    if (getVid()) return;                                   // this browser was already counted once, never count it again
    const vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem("trendly_vid", vid); } catch (_) {}
    if (getVid() !== vid) return;                           // storage blocked: can't dedupe, so don't count
    await api("visit", { vid }, { anon: true });
    log.info("New visitor recorded");
  } catch (e) { log.warn("Visit tracking skipped:", e); }
}
const visitDone = trackVisit();                             // safe to call twice: the vid check above stops a second count

function linkVisitor(user) {                                              // attach the account to this visitor
  try {
    const k = "trendly_linked_" + user.uid;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
    visitDone.then(() => { const vid = getVid(); return vid && api("link", { vid }, { user }); })
      .catch(e => log.warn("Link visitor:", e));
  } catch (e) { log.warn("Link visitor:", e); }
}

/* ---------- Dark / light toggle ---------- */
const themeBtn = $("themeBtn");
const curTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function applyTheme(t, save) {
  const h = document.documentElement;
  h.classList.add("theme-anim");
  h.dataset.theme = t;
  themeBtn.classList.toggle("is-dark", t === "dark");
  themeBtn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  if (save) { try { localStorage.setItem("trendly_theme", t); } catch (_) {} }
  setTimeout(() => h.classList.remove("theme-anim"), 400);
}
themeBtn.onclick = () => applyTheme(curTheme() === "dark" ? "light" : "dark", true);
applyTheme(curTheme(), false);

/* ---------- "What's new" pill (sirf logged-in users, ek baar) ---------- */
const WN_KEY = "trendly_whatsnew_v4";
function updateWnew() {
  let seen = false;
  try { seen = !!localStorage.getItem(WN_KEY); } catch (_) {}
  $("wnew").classList.toggle("hidden", !currentUser || seen);
}
$("wnew").onclick = () => { $("wnew").classList.add("hidden"); try { localStorage.setItem(WN_KEY, "1"); } catch (_) {} };
updateWnew();
/* ---------- Admin notice: Firebase "notice" true ho to poori site block ---------- */
firebase.database().ref("notice").on("value", (s) => {
  const n = s.val() || {};
  const on = n.active === true;
  $("noticeTitle").textContent = n.title || "";
  $("noticeBody").textContent = n.message || "";
  $("noticeModal").classList.toggle("hidden", !on);
  document.body.style.overflow = on ? "hidden" : "";
  ["homeView", "authView", "historyView", "setupView"].forEach(id => { $(id).inert = on; }); // keyboard se bhi kuch na ho
  if (on) tutHide();
}, (e) => log.warn("Notice listener:", e));

/* ---------- Start state ---------- */
/* Competitor box ka purana state wapas lagao (applyMode se pehle) */
try {
  const c = JSON.parse(localStorage.getItem("trendly_ct") || "{}");
  if (c.sub === "tags" || c.sub === "plan") ctSub = c.sub;
  $("ctUrl").value = String(c.u1 || "").slice(0, 300);
  $("ctUrl2").value = String(c.u2 || "").slice(0, 300);
} catch (_) {}
let startMode = "tags";
try { const sm = localStorage.getItem("trendly_mode"); if (sm === "hook" || sm === "ct" || sm === "prompt") startMode = sm; } catch (_) {}
applyMode(startMode);                                    // pichli baar jo mode tha wahi khulega
renderCoins();