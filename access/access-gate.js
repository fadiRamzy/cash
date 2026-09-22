/* Employee access gate — username only. Loaded by every page; blocks the page
   until a username is entered and not found to be blocked in users.json.
   Shared by all pages via a single external file. */
(function () {
  'use strict';

  // ====================== REQUIRED CONFIG — fill in before deploying ======================
  // GitHub repo that hosts users.json (usually this same Pages repo).
  var GH_OWNER = 'fadiramzy';
  var GH_REPO = 'cash';
  var GH_BRANCH = 'main';
  var USERS_PATH = 'users.json';
  // Fine-grained Personal Access Token scoped ONLY to this repo, with
  // "Issues: Read and write" and NOTHING else (Contents must be No access).
  // This token is public (visible in page source) by design — it can only
  // ever create Issues, never touch users.json or any repo file.
  var ISSUES_TOKEN = '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';
  // ==========================================================================================

  var SESSION_KEY = 'cashAccessSession';
  var RECHECK_MS = 90000; // how often an unlocked page re-checks users.json for revocation

  function usersUrl() {
    // Cache-busting query so each check hits the CDN fresh rather than a stale cached copy.
    return 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + USERS_PATH + '?_=' + Date.now();
  }

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && typeof s.u === 'string' && s.u ? s : null;
    } catch (e) { return null; }
  }
  function setSession(u) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ u: u, at: Date.now() })); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // Resolves to the users.json object, or null if it could not be read (offline, etc).
  function fetchUsers() {
    return fetch(usersUrl(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Fire-and-forget: quietly record a first-time username as a GitHub Issue.
  // Uses only the Issues-scoped token, which cannot modify users.json.
  function reportNewUsername(username) {
    if (!ISSUES_TOKEN || ISSUES_TOKEN.indexOf('PUT_') === 0) return;
    fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/issues', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ISSUES_TOKEN,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'New login: ' + username,
        body: 'Username: ' + username +
          '\nFirst seen: ' + new Date().toISOString() +
          '\nPage: ' + location.pathname
      })
    }).catch(function () {});
  }

  function statusOf(users, username) {
    if (!users || typeof users !== 'object') return 'unknown';
    var e = users[username];
    if (!e) return 'unknown';
    return e.status === 'blocked' ? 'blocked' : 'allowed';
  }

  var on = 0;
  function gate() {
    if (on) return;
    on = 1;
    var d = document, css = d.createElement('style'), box = d.createElement('div');
    css.textContent =
      'html{overflow:hidden!important}' +
      'body>*:not(#cashGate),body>*:not(#cashGate) *{visibility:hidden!important}' +
      '#cashGate{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;background:#F7F8FA;color:#20293A;direction:rtl;font-family:"Times New Roman",Times,serif;font-size:15px;line-height:1.6;visibility:visible!important}' +
      '#cashGate *{box-sizing:border-box;margin:0}' +
      '#cashGate .cg{width:100%;max-width:380px;background:#fff;border:1px solid rgba(28,42,58,.09);border-radius:20px;padding:30px 24px 24px;text-align:center;box-shadow:0 10px 28px rgba(28,42,58,.09)}' +
      '#cashGate .cg-i{width:48px;height:48px;margin:0 auto 14px;border-radius:50%;background:#EEF4FC;display:flex;align-items:center;justify-content:center}' +
      '#cashGate h1{font-size:18px;font-weight:700;margin-bottom:4px}' +
      '#cashGate p{font-size:13px;color:#67728A}' +
      '#cashGate input{display:block;width:100%;height:46px;margin:18px 0 6px;padding:0 14px;border:1px solid rgba(28,42,58,.16);border-radius:12px;background:#fff;color:#20293A;font:16px "Times New Roman",Times,serif;text-align:center;direction:ltr;outline:0}' +
      '#cashGate input:focus{border-color:#1C5EA8;box-shadow:0 0 0 3px rgba(28,94,168,.14)}' +
      '#cashGate .cg-e{min-height:22px;font-size:13px;color:#C24545}' +
      '#cashGate button{width:100%;height:46px;margin-top:4px;border:0;border-radius:12px;background:#1C5EA8;color:#fff;font:700 15px "Times New Roman",Times,serif;cursor:pointer}' +
      '#cashGate button:disabled{opacity:.6;cursor:default}' +
      '#cashGate button:not(:disabled):hover{background:#164A85}';
    box.id = 'cashGate';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<div class="cg"><div class="cg-i"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1C5EA8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>' +
      '<h1>\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644</h1>' +
      '<p>\u0623\u062F\u062E\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629</p>' +
      '<input type="text" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" aria-label="\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645">' +
      '<div class="cg-e" role="alert"></div>' +
      '<button type="button">\u062F\u062E\u0648\u0644</button></div>';

    function mount() {
      d.head.appendChild(css);
      d.body.appendChild(box);
      var inp = box.getElementsByTagName('input')[0], err = box.querySelector('.cg-e'), btn = box.getElementsByTagName('button')[0];
      function note(m) { err.textContent = m; }
      function busy(b) { btn.disabled = b; inp.disabled = b; }
      function go() {
        var u = (inp.value || '').trim();
        if (!u) { note('\u0627\u0644\u0631\u062C\u0627\u0621 \u0625\u062F\u062E\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645'); return; }
        note(''); busy(true);
        fetchUsers().then(function (users) {
          busy(false);
          if (users === null) { note('\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644\u060C \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649'); return; }
          var st = statusOf(users, u);
          if (st === 'blocked') { note('\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645'); return; }
          if (st === 'unknown') reportNewUsername(u);
          setSession(u);
          css.parentNode.removeChild(css); box.parentNode.removeChild(box); on = 0;
          watch();
        });
      }
      btn.addEventListener('click', go);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      setTimeout(function () { inp.focus(); }, 0);
    }
    if (d.body) mount(); else d.addEventListener('DOMContentLoaded', mount);
  }

  // Re-checks users.json for a signed-in session; gates the page if it is now blocked.
  function recheck() {
    var s = getSession();
    if (!s) return;
    fetchUsers().then(function (users) {
      if (users === null) return; // read failed — fail open, don't kick a valid user over a network blip
      if (statusOf(users, s.u) === 'blocked') { clearSession(); gate(); }
    });
  }
  var timer = null;
  function watch() {
    if (timer) clearInterval(timer);
    timer = setInterval(recheck, RECHECK_MS);
  }

  // Registered once, unconditionally: recheck() itself is a no-op with no session,
  // so this covers both a page that loaded already-logged-in and one where login
  // happens interactively through the gate on this same page view.
  addEventListener('pageshow', recheck);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });

  if (getSession()) {
    watch();
    recheck(); // catch a revocation that happened since the last visit
  } else {
    gate();
  }
})();
