/* Trenndly "Replies" (user side, read-only). Loaded after app.js.
   Users cannot type here. Their messages are saved by the Worker (action "feedback"),
   and this page only shows the conversation + admin replies.
   Data:  chatMeta/{uid}        -> { email, name, lastMsg, lastMsgAt, lastFrom, unreadAdmin, unreadUser }
          chatMsgs/{uid}/{id}   -> { from: "user"|"admin", text, kind, createdAt }
   The only thing this file writes is chatMeta/{uid}/unreadUser = false (allowed by the rules). */
(function () {
  const LABEL = "Replies";                       // <- button / page name, change it here
  const $ = (id) => document.getElementById(id);
  const db = () => firebase.database();
  const fmt = (t) => t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

  let uid = null, metaRef = null, msgRef = null;
  let meta = {}, msgs = [], isOpen = false;

  function buildUI() {
    const dot1 = document.createElement("span");
    dot1.className = "rdot hidden"; dot1.id = "menuDot";
    $("menuBtn").appendChild(dot1);

    const nav = document.querySelector(".drawer-nav");

    /* Dark mode on/off row (under History). Uses the existing theme logic in app.js via the hidden header button. */
    const tg = document.createElement("button");
    tg.className = "nav-item"; tg.id = "navTheme";
    tg.setAttribute("role", "switch");
    tg.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span class="nav-lbl">Dark mode</span><span class="switch" aria-hidden="true"><i></i></span>';
    nav.appendChild(tg);
    const syncTheme = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      tg.classList.toggle("is-on", dark);
      tg.setAttribute("aria-checked", String(dark));
    };
    tg.onclick = () => $("themeBtn").click();            // drawer stays open
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    syncTheme();

    const b = document.createElement("button");
    b.className = "nav-item"; b.id = "navChat";
    b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="nav-lbl"></span><span class="rdot hidden" id="navDot"></span>';
    b.querySelector(".nav-lbl").textContent = LABEL;
    nav.appendChild(b);

    const v = document.createElement("section");
    v.id = "chatView"; v.className = "chatview hidden";
    v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true");
    v.innerHTML =
      '<header class="top"><div class="left">' +
      '<button class="menu-btn" id="chatBack" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="brand" id="chatTitle"></span></div></header>' +
      '<div class="chat-body" id="chatBody"></div>';
    document.body.appendChild(v);
    $("chatTitle").textContent = LABEL;

    $("navChat").onclick = () => { $("drawerClose").click(); openChat(); };
    $("chatBack").onclick = closeChat;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) closeChat(); });
  }

  function updateDots() {
    const unread = !!(uid && meta.unreadUser);
    $("menuDot").classList.toggle("hidden", !unread);
    $("navDot").classList.toggle("hidden", !unread);
  }

  function openChat() {
    if (!uid) return;
    isOpen = true;
    $("chatView").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    $("chatBody").dataset.init = "";
    render(); markRead();
  }
  function closeChat() {
    isOpen = false;
    $("chatView").classList.add("hidden");
    document.body.style.overflow = "";
  }
  function markRead() {
    if (uid && meta.unreadUser) db().ref("chatMeta/" + uid + "/unreadUser").set(false).catch(() => {});
  }

  function render() {
    const box = $("chatBody");
    box.innerHTML = "";
    if (!msgs.length) {
      const e = document.createElement("div");
      e.className = "chat-empty";
      e.textContent = "No messages yet. Send us a problem or suggestion with the Feedback button, and our reply will show up here.";
      box.appendChild(e);
      return;
    }
    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "bub-row " + (m.from === "admin" ? "admin" : "me");
      const b = document.createElement("div"); b.className = "bub";
      if (m.from === "admin") { const who = document.createElement("small"); who.className = "bub-who"; who.textContent = "Trenndly team"; b.appendChild(who); }
      const p = document.createElement("p"); p.textContent = m.text || ""; b.appendChild(p);
      const t = document.createElement("small"); t.className = "bub-time"; t.textContent = fmt(m.createdAt); b.appendChild(t);
      row.appendChild(b); box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  function detach() {
    if (metaRef) metaRef.off();
    if (msgRef) msgRef.off();
    metaRef = msgRef = null; meta = {}; msgs = [];
  }
  function init() {
    buildUI();
    firebase.auth().onAuthStateChanged((u) => {
      detach(); uid = u ? u.uid : null;
      if (!u) { closeChat(); updateDots(); return; }
      metaRef = db().ref("chatMeta/" + uid);
      metaRef.on("value", (s) => { meta = s.val() || {}; updateDots(); if (isOpen) markRead(); },
        (e) => console.warn("[Replies] meta:", e.code));
      msgRef = db().ref("chatMsgs/" + uid).orderByChild("createdAt").limitToLast(200);
      msgRef.on("value", (s) => {
        const a = []; s.forEach((c) => { a.push({ id: c.key, ...c.val() }); });
        msgs = a; if (isOpen) { render(); markRead(); }
      }, (e) => console.warn("[Replies] msgs:", e.code));
    });
  }
  init();
})();