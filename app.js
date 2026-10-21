/* Viral Tags for YouTube. Console stays silent unless DEBUG is true. */
const DEBUG = true;                      // true karoge tabhi console mein logs dikhenge
const log = {
  info: (...a) => { if (DEBUG) console.log("%c[ViralTags]", "color:#D92D20;font-weight:bold", ...a); },
  warn: (...a) => { if (DEBUG) console.warn("[ViralTags]", ...a); },
  error: (...a) => { if (DEBUG) console.error("[ViralTags]", ...a); }
};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

firebase.initializeApp(firebaseConfig);

/* ---------- Views & Auth ---------- */
let currentUser = null, signupMode = false;

function showHome() {
  if (typeof TUT !== "undefined" && (TUT.step === 4 || TUT.step === 45)) tutHide();
  $("authView").classList.add("hidden");
  $("historyView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  window.scrollTo(0, 0);
}
function showAuth(signup) {
  setMode(signup);
  $("historyView").classList.add("hidden");
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
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/unauthorized-domain": "This domain is not authorized for sign-in."
  };
  $("authMsg").textContent = map[e.code] || "Something went wrong. Please try again.";
}

async function ensureProfile(user, name) {
  try {
    const ref = firebase.database().ref("users/" + user.uid);
    const snap = await ref.once("value");
    if (!snap.exists()) {
      await ref.set({
        username: name || user.displayName || (user.email || "user").split("@")[0],
        photoURL: user.photoURL || "https://i.ibb.co/album/default.jpg",
        email: user.email || ""
      });
    }
  } catch (e) { log.warn("Profile:", e); }
}

$("authBtn").onclick = async () => {
  const email = $("aEmail").value.trim(), pass = $("aPass").value;
  $("authMsg").textContent = "";
  if (!email || !pass) { $("authMsg").textContent = "Enter your email and password."; return; }
  $("authBtn").disabled = true;
  try {
    if (signupMode) {
      const name = $("aName").value.trim();
      if (!name) { $("authMsg").textContent = "Enter a username."; return; }
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      await ensureProfile(cred.user, name);
    } else {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
    }
  } catch (e) { authError(e); }
  finally { $("authBtn").disabled = false; }
};

$("googleBtn").onclick = async () => {
  tutOn("gclick");
  try {
    const cred = await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    await ensureProfile(cred.user);
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

firebase.auth().onAuthStateChanged((user) => {
  currentUser = user;
  document.documentElement.classList.remove("was-in");          // remove header placeholders
  try { localStorage.setItem("trendly_auth", user ? "1" : "0"); } catch (_) {}
  $("guestActions").classList.toggle("hidden", !!user);
  $("userMenu").classList.toggle("hidden", !user);
  $("fbOpen").classList.toggle("hidden", !user);
  $("menuBtn").classList.toggle("hidden", !user);
  $("fbLink").classList.toggle("hidden", !user);
  $("adminLink").classList.toggle("hidden", !(user && ADMIN_EMAILS.includes((user.email || "").toLowerCase())));
  if (user) {
    log.info("Signed in as", user.email || user.displayName);
    renderAvatar(user);
    $("popEmail").textContent = user.email || user.displayName || "Account";
    showHome();
    sweepHistory(user.uid);
    linkVisitor(user);
    if (TUT.step === 4 || TUT.step === 45) tutHide();
    try { localStorage.setItem("trendly_login_tut", "1"); } catch (_) {}
    maybeStartTutorial(user);
  } else {
    log.info("Browsing as guest");
    setDrawer(false); tutHide(); $("historyView").classList.add("hidden");
    setPop(false);
    if ($("authView").classList.contains("hidden")) showHome();
  }
});

/* Login-required modal */
$("modalOk").onclick = () => { $("loginModal").classList.add("hidden"); showAuth(false); };

/* ---------- File selection ---------- */
let chosen = null;
function showError(m) { $("errBox").textContent = m; $("errBox").classList.remove("hidden"); }
function hideError() { $("errBox").classList.add("hidden"); }

/* Button states: idle (none) | ready (Analyze + Upload another) | running (none) | done (Upload another only) */
function setUI(state) {
  $("btnRow").classList.toggle("hidden", state === "idle" || state === "running");
  $("go").classList.toggle("hidden", state !== "ready");
  $("again").classList.toggle("hidden", state !== "ready" && state !== "done");
}
setUI("idle");
$("again").onclick = () => { $("file").value = ""; $("file").click(); };

function setFile(f) {
  if (running) return;
  hideError();
  if (!f) return;
  if (!f.type.startsWith("video")) return showError("Please choose a video file.");
  if (f.size > MAX_SIZE) return showError(`File is too large. The maximum size is ${Math.round(MAX_SIZE / 1048576)} MB.`);
  chosen = f;
  $("fname").textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
  $("preview").innerHTML = "";
  const v = document.createElement("video");
  v.src = URL.createObjectURL(f);
  v.controls = true;
  $("preview").appendChild(v);
  $("results").classList.add("hidden");
  setUI("ready");
  $("dropEmpty").classList.add("hidden");
  log.info("Video selected:", f.name, f.type, f.size + " bytes");
  tutOn("selected");
}
$("pick").onclick = () => { tutOn("pick"); $("file").click(); };
$("file").onchange = (e) => setFile(e.target.files[0]);
["dragover", "dragenter"].forEach(ev => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

/* ---------- Gemini ---------- */
const PROMPT = `Watch this ENTIRE video from start to end, and listen to its audio and speech.
Understand what the video is really about: topic, people, actions, objects, setting, spoken words, mood, and the niche.
Then write YouTube SEO data in English, based only on what is actually in the video:
- tags: 10 to 15 YouTube tags (mix of short and long-tail, no # symbol)
- hashtags: exactly 20 hashtags, each starting with #, no spaces inside
- keywords: 15 to 20 searchable keywords or phrases people would type in YouTube search
- topics: 3 short search phrases (2 to 4 words each, main topic only, no # symbol) that a viewer would type into YouTube search to find this video
- titles: exactly 5 catchy, click-worthy but honest English titles, each under 70 characters`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    tags: { type: "ARRAY", items: { type: "STRING" } },
    hashtags: { type: "ARRAY", items: { type: "STRING" } },
    keywords: { type: "ARRAY", items: { type: "STRING" } },
    titles: { type: "ARRAY", items: { type: "STRING" } },
    topics: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["tags", "hashtags", "keywords", "titles", "topics"]
};

const gHeaders = { "x-goog-api-key": GEMINI_API_KEY };

async function geminiUpload(file) {
  const b = "----ytb" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ file: { display_name: file.name.substring(0, 60) } });
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${file.type || "video/mp4"}\r\n\r\n`,
    file,
    `\r\n--${b}--`
  ]);
  const res = await fetch(`${GEMINI}/upload/v1beta/files`, {
    method: "POST",
    headers: { ...gHeaders, "X-Goog-Upload-Protocol": "multipart", "Content-Type": `multipart/related; boundary=${b}` },
    body
  });
  if (!res.ok) throw new Error("Gemini file upload " + res.status + ": " + (await res.text()).slice(0, 200));
  return (await res.json()).file;
}

async function geminiWaitActive(f) {
  const deadline = Date.now() + 300000;                 // bade videos ko processing mein zyada time lagta hai
  while (f.state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini video processing timeout");
    await sleep(2500);
    const r = await fetch(`${GEMINI}/v1beta/${f.name}`, { headers: gHeaders });
    if (!r.ok) throw new Error("Gemini file status " + r.status);
    f = await r.json();
  }
  if (f.state === "FAILED") throw new Error("Gemini could not process the video");
  return f;
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("File read failed"));
    r.readAsDataURL(file);
  });
}

async function generate(videoPart) {
  const body = JSON.stringify({
    contents: [{ parts: [videoPart, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA }
  });
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 150000);
      try {
        log.info(`Generating with ${model} (attempt ${attempt + 1})`);
        const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, {
          method: "POST", signal: ctrl.signal,
          headers: { ...gHeaders, "Content-Type": "application/json" }, body
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
          if (!text) throw new Error("Gemini returned an empty response (possibly blocked by safety filters)");
          return JSON.parse(text.replace(/```json|```/g, "").trim());
        }
        lastErr = new Error(`Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
        log.warn(lastErr.message);
        if (res.status === 404) break;
        if (res.status === 400 || res.status === 403) throw lastErr;
        await sleep(1500);
      } catch (e) {
        if (e === lastErr && /\b(400|403)\b/.test(e.message)) throw e;
        lastErr = e;
      } finally { clearTimeout(timer); }
    }
  }
  throw lastErr || new Error("All Gemini models failed");
}

async function analyzeWithGemini(file) {
  let gFile = null;
  try {
    let part;
    try {
      log.info("Uploading video to Gemini...");
      gFile = await geminiUpload(file);
      log.info("Waiting for Gemini to process the video...");
      gFile = await geminiWaitActive(gFile);
      part = { file_data: { mime_type: gFile.mimeType, file_uri: gFile.uri } };
    } catch (e) {
      if (file.size > 15 * 1024 * 1024) throw e;
      log.warn("Files API failed, falling back to inline upload:", e);
      part = { inline_data: { mime_type: file.type, data: await fileToBase64(file) } };
    }
    log.info("Gemini is analyzing the video...");
    return await generate(part);
  } finally {
    // The video is removed from Gemini as soon as analysis ends
    if (gFile?.name) fetch(`${GEMINI}/v1beta/${gFile.name}`, { method: "DELETE", headers: gHeaders }).catch(() => {});
  }
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

/* ---------- YouTube search suggestions (free, no API key) ---------- */
/* Real searches people type on YouTube. If anything fails we silently fall back to Gemini-only results. */
const YT_SUGGEST = "https://suggestqueries.google.com/complete/search";
let jsonpSeq = 0;

const uniq = (arr) => { const seen = new Set(); return arr.filter(x => { const k = String(x).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const roundRobin = (...lists) => {                       // a1, b1, a2, b2 ... so every source gets a fair share
  const out = [], n = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < n; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
};

function parseSuggest(data) {                            // handles both ["q",["a","b"]] and ["q",[["a",0],["b",0]]]
  const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  return list.map(x => String(Array.isArray(x) ? x[0] : x).trim()).filter(Boolean);
}
const ytUrl = (q, client, extra = "") =>
  `${YT_SUGGEST}?client=${client}&ds=yt&hl=${YT_LANG}&gl=${YT_REGION}&q=${encodeURIComponent(q)}${extra}`;

/* YouTube's suggest endpoint sends no CORS header, so fetch() is blocked in browsers.
   A <script> tag (JSONP) is not subject to CORS, so that is the only method used. */
function ytSuggestOne(q, ms = 4000) {
  return new Promise((resolve) => {
    const cb = "__ytsug" + (++jsonpSeq) + "_" + Date.now().toString(36);
    const s = document.createElement("script");
    let timer = null, finished = false;
    const done = (v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); s.remove();
      window[cb] = () => {};                              // response late aaye to bhi "not defined" error nahi aayega
      setTimeout(() => { delete window[cb]; }, 60000);
      resolve(v);
    };
    timer = setTimeout(() => done([]), ms);
    window[cb] = (data) => done(parseSuggest(data));
    s.onerror = () => done([]);
    s.src = ytUrl(q, "youtube", "&jsonp=" + cb);
    document.head.appendChild(s);
  });
}

async function ytSuggestions(d) {                        // Gemini topics (+ first 2 tags) -> real YouTube searches
  const t0 = Date.now();
  const seeds = uniq([...(d.topics || []), ...(d.tags || []).slice(0, 2)]
    .map(s => String(s).replace(/^#/, "").trim()).filter(Boolean)).slice(0, 4);
  if (!seeds.length) return [];
  try {
    const lists = await Promise.all(seeds.map(s => ytSuggestOne(s).catch(() => [])));
    const out = uniq(roundRobin(...lists).filter(s => s.length <= 60));
    log.info(`YouTube suggestions: ${out.length} found for`, seeds, `in ${Date.now() - t0} ms`);
    return out;
  } catch (e) { log.warn("YouTube suggestions skipped:", e); return []; }
}

/* Mix Gemini + YouTube. Tags stay inside YouTube's 500 character limit. */
function mergeYT(d, yt) {
  const g = normalize(d);
  const tagsYT = yt.filter(s => s.length <= 35 && !s.includes(","));
  const hashYT = uniq(yt.map(s => "#" + s.replace(/[^\p{L}\p{M}\p{N}_]+/gu, "")).filter(h => h.length >= 4 && h.length <= 26));

  const tags = []; let len = 0;
  for (const t of uniq(roundRobin(g.tags, tagsYT))) {
    const add = t.length + (tags.length ? 2 : 0);
    if (tags.length >= 20 || len + add > 500) continue;
    tags.push(t); len += add;
  }
  const hashtags = uniq(roundRobin(g.hashtags, hashYT)).slice(0, 20);
  const keywords = uniq(roundRobin(yt, g.keywords)).slice(0, 20);

  return { tags, hashtags, keywords, titles: g.titles };
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
function renderScore(r) {
  const sc = seoScore(r), fill = $("ringFill");
  fill.style.transition = "none";
  fill.style.strokeDashoffset = "119.4";
  fill.getBoundingClientRect();                              // reflow, taaki animation phir se chale
  fill.style.transition = "";
  fill.style.stroke = sc >= 75 ? "var(--green)" : sc >= 50 ? "var(--warn)" : "var(--danger)";
  fill.style.strokeDashoffset = String(119.4 * (1 - sc / 100));
  countUp($("scoreNum"), sc);
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
    b.onclick = async () => { const ok = await writeClip(t); b.classList.add("done"); toast(ok ? "Tag copied \u2713" : "Couldn't copy"); };
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
  running = true;
  hideError();
  setUI("running");
  tutOn("analyze");
  $("results").classList.add("hidden");
  startSkeleton();

  const file = chosen, user = currentUser, t0 = Date.now();

  const ai = await analyzeWithGemini(file)
    .then(d => { log.info("Analysis complete:", d); return { data: d }; })
    .catch(e => { log.error(e); return { error: e.message }; });

  logAnalysis(user, file, !ai.error, Date.now() - t0);

  // Mix Gemini's result with real YouTube searches (max 5 s wait, never blocks the result)
  let data = null;
  if (!ai.error) data = mergeYT(ai.data, await Promise.race([ytSuggestions(ai.data), sleep(5000).then(() => [])]));

  const thumb = ai.error ? null : await Promise.race([thumbPromise, sleep(2500).then(() => null)]);
  stopSkeleton();
  if (ai.error) { showError("We couldn't analyze this video. Please try again."); tutOn("failed"); }
  else {
    const res = showResults(data);
    saveHistory(user, file, res, thumb).catch(e => log.warn("History save failed:", e));
  }

  running = false;
  setUI(ai.error ? "ready" : "done");
};


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

/* Grab 6 real frames from the user's video for the filmstrip */
let thumbPromise = Promise.resolve(null);
async function captureFrames(file) {
  let thumb = null;
  const token = ++capToken;
  const frames = document.querySelectorAll("#skel .fr");
  frames.forEach(f => f.style.backgroundImage = "");
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; setTimeout(rej, 5000); });
    const cv = document.createElement("canvas"); cv.width = 160; cv.height = 100;
    const ctx = cv.getContext("2d");
    for (let i = 0; i < frames.length; i++) {
      if (token !== capToken) return null;
      v.currentTime = (v.duration || 1) * (i + 0.5) / frames.length;
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

function startSkeleton() {
  let i = 0;
  buildWave();
  setSteps(0);
  $("skel").classList.remove("hidden");
  $("skel").scrollIntoView({ behavior: lowEnd ? "auto" : "smooth", block: "nearest" });
  thumbPromise = chosen ? captureFrames(chosen) : Promise.resolve(null);
  clearInterval(stepTimer);
  stepTimer = setInterval(() => { i = Math.min(i + 1, 3); setSteps(i); }, 5000);
}
function stopSkeleton() {
  clearInterval(stepTimer);
  capToken++;
  $("skel").classList.add("hidden");
}


/* ---------- Feedback: users can share problems ---------- */
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
  let last = 0; try { last = +localStorage.getItem("fbLast") || 0; } catch (_) {}
  if (Date.now() - last < 30000) { $("fbErr").textContent = "Please wait a few seconds before sending again."; return; }

  $("fbSend").disabled = true;
  try {
    await firebase.database().ref("feedback").push({
      type: fbType, message: msg, email: currentUser.email || "",
      uid: currentUser.uid,
      name: currentUser.displayName || "",
      page: location.href, userAgent: navigator.userAgent.slice(0, 200),
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    try { localStorage.setItem("fbLast", String(Date.now())); } catch (_) {}
    log.info("Feedback sent:", fbType);
    $("fbMsg").value = ""; $("fbCount").textContent = "0";
    $("fbBody").classList.add("hidden"); $("fbDone").classList.remove("hidden");
  } catch (e) {
    log.error("Feedback failed:", e);
    $("fbErr").textContent = "Couldn't send your message. Please try again.";
  } finally { $("fbSend").disabled = false; }
};


/* ---------- Side menu ---------- */
function setDrawer(open) {
  $("drawer").classList.toggle("open", open);
  $("scrim").classList.toggle("open", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
}
$("menuBtn").onclick = () => setDrawer(true);
$("drawerClose").onclick = () => setDrawer(false);
$("scrim").onclick = () => setDrawer(false);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
$("navHistory").onclick = () => { setDrawer(false); showHistory(); };
$("hBack").onclick = showHome;

/* ---------- History (kept 7 days, then deleted from Firebase) ---------- */
const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

async function saveHistory(user, file, res, thumb) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const thumbData = thumb ? await blobToDataUrl(thumb) : "";   // small JPEG stored inline in Firebase
  const now = Date.now();
  await firebase.database().ref(`history/${user.uid}/${id}`).set({
    createdAt: now, expiresAt: now + HISTORY_MS, fileName: file.name.slice(0, 80),
    thumbData, ...res
  });
  log.info("Saved to history (deleted automatically after 7 days):", id);
}

async function removeHistoryItem(uid, id) {
  await firebase.database().ref(`history/${uid}/${id}`).remove();
}

async function sweepHistory(uid) {
  try {
    const snap = await firebase.database().ref("history/" + uid).once("value");
    const now = Date.now();
    const jobs = [];
    snap.forEach(c => { const v = c.val() || {}; if ((v.expiresAt || 0) <= now) jobs.push(removeHistoryItem(uid, c.key)); });
    if (jobs.length) { await Promise.all(jobs); log.info("Deleted expired history items:", jobs.length); }
  } catch (e) { log.warn("History sweep:", e); }
}

function showHistory() {
  $("homeView").classList.add("hidden");
  $("authView").classList.add("hidden");
  $("historyView").classList.remove("hidden");
  window.scrollTo(0, 0);
  loadHistory();
}

async function loadHistory() {
  const list = $("hList");
  list.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const snap = await firebase.database().ref("history/" + currentUser.uid).once("value");
    const now = Date.now(), items = [];
    snap.forEach(c => { const v = c.val(); if (v && (v.expiresAt || 0) > now) items.push({ id: c.key, ...v }); });
    items.sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = "";
    if (!items.length) { list.innerHTML = '<div class="empty">No history yet. Analyze a video and it will appear here.</div>'; return; }
    items.forEach((it, i) => { const c = histCard(it, now); c.style.animationDelay = Math.min(i, 8) * 40 + "ms"; list.appendChild(c); });
  } catch (e) {
    log.error("History load failed:", e);
    list.innerHTML = '<div class="empty">Couldn\'t load your history. Please try again.</div>';
  }
}

function histCard(it, now) {
  const art = document.createElement("article"); art.className = "hc";
  const head = document.createElement("button"); head.className = "hc-head";
  const th = document.createElement("span"); th.className = "hc-thumb";
  const src = it.thumbData || it.thumbUrl;
  if (src) th.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
  const meta = document.createElement("span"); meta.className = "hc-meta";
  const days = Math.max(1, Math.ceil((it.expiresAt - now) / 86400000));
  const b = document.createElement("b"); b.textContent = (it.titles && it.titles[0]) || it.fileName || "Video";
  const sp = document.createElement("span");
  sp.textContent = new Date(it.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + " · Deletes in " + days + (days === 1 ? " day" : " days");
  meta.append(b, sp);
  const chev = document.createElement("i"); chev.className = "chev";
  head.append(th, meta, chev);

  const body = document.createElement("div"); body.className = "hc-body hidden";
  [["Tags", (it.tags || []).join(", ")], ["Hashtags", (it.hashtags || []).join(" ")],
   ["Keywords", (it.keywords || []).join(", ")], ["Titles", (it.titles || []).join("\n")]].forEach(([label, text]) => {
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

  head.onclick = () => { const open = body.classList.toggle("hidden") === false; art.classList.toggle("open", open); };
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


/* ---------- Analytics for the admin panel (visits incl. guests, and who analyzed what) ---------- */
const getVid = () => { try { return localStorage.getItem("trendly_vid"); } catch (_) { return null; } };
const dayKey = () => new Date().toLocaleDateString("en-CA");           // YYYY-MM-DD

async function trackVisit() {
  try {
    if (getVid()) return;                                   // this browser was already counted once, never count it again
    const vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem("trendly_vid", vid); } catch (_) {}
    if (getVid() !== vid) return;                           // storage blocked: can't dedupe, so don't count
    const db = firebase.database(), TS = firebase.database.ServerValue.TIMESTAMP;
    const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop";
    await db.ref("analytics/visitors/" + vid).set({ firstSeen: TS, device });
    db.ref("analytics/days/" + dayKey()).update({ new: firebase.database.ServerValue.increment(1) });
    log.info("New visitor recorded");
  } catch (e) { log.warn("Visit tracking skipped:", e); }
}

function linkVisitor(user) {                                              // attach the account to this visitor
  try {
    const vid = getVid(), k = "trendly_linked_" + user.uid;
    if (!vid || sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
    firebase.database().ref("analytics/visitors/" + vid).update({ uid: user.uid, email: user.email || "", name: user.displayName || "" });
  } catch (e) { log.warn("Link visitor:", e); }
}

function logAnalysis(user, file, ok, ms) {
  firebase.database().ref("analytics/analyses").push({
    uid: user.uid, email: user.email || "", name: user.displayName || "",
    fileName: file.name.slice(0, 80), sizeMB: +(file.size / 1048576).toFixed(1),
    status: ok ? "ok" : "failed", ms, createdAt: firebase.database.ServerValue.TIMESTAMP
  }).catch(e => log.warn("Analysis log failed:", e));
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

/* ---------- "What's new" pill (ek baar dikhta hai) ---------- */
const WN_KEY = "trendly_whatsnew_v2";
try { if (!localStorage.getItem(WN_KEY)) $("wnew").classList.remove("hidden"); } catch (_) {}
$("wnew").onclick = () => { $("wnew").classList.add("hidden"); try { localStorage.setItem(WN_KEY, "1"); } catch (_) {} };

trackVisit();