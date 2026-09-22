/* Employee access gate — username only. Loaded by every page; blocks the page
   until a username is entered and not found to be blocked in users.json.
   Shared by all pages via a single external file. */
(function () {
  'use strict';

  // ====================== REQUIRED CONFIG — fill in before deploying ======================
  // GitHub repo that hosts users.json and devices.json (usually this same Pages repo).
  var GH_OWNER = 'fadiRamzy';
  var GH_REPO = 'cash';
  var GH_BRANCH = 'main';
  var USERS_PATH = 'users.json';
  var DEVICES_PATH = 'devices.json';
  var DEFAULT_MAX_DEVICES = 3;

  // Fine-grained Personal Access Token scoped ONLY to this repo, with
  // Contents: Read and write (for devices.json).
  var GH_TOKEN = '__GH_TOKEN__';

  // Fine-grained Personal Access Token scoped ONLY to this repo, with
  // Issues: Read and write (Contents: No access).
  var ISSUES_TOKEN = '__ISSUES_TOKEN__';
  // ==========================================================================================

  var SESSION_KEY = 'cashAccessSession';
  var DEVICE_KEY = 'cashDeviceId';
  var RECHECK_MS = 5000; // 5 seconds real-time re-check for revocation / unblocking

  function getContentsToken() {
    if (typeof window !== 'undefined' && window.GH_TOKEN) return window.GH_TOKEN;
    if (GH_TOKEN && GH_TOKEN.indexOf('__') !== 0) return GH_TOKEN;
    return '';
  }

  function getIssuesToken() {
    if (typeof window !== 'undefined' && window.ISSUES_TOKEN) return window.ISSUES_TOKEN;
    if (ISSUES_TOKEN && ISSUES_TOKEN.indexOf('__') !== 0 && ISSUES_TOKEN.indexOf('PUT_') !== 0) return ISSUES_TOKEN;
    if (GH_TOKEN && GH_TOKEN.indexOf('__') !== 0) return GH_TOKEN;
    return '';
  }

  function b64DecodeUtf8(str) {
    return decodeURIComponent(
      escape(
        atob(
          String(str).replace(/\n/g, '')
        )
      )
    );
  }

  function b64EncodeUtf8(str) {
    return btoa(
      unescape(
        encodeURIComponent(str)
      )
    );
  }

  function getDeviceId() {
    var id = null;
    try {
      id = localStorage.getItem(DEVICE_KEY);
    } catch (e) {}
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
      }
      try {
        localStorage.setItem(DEVICE_KEY, id);
      } catch (e) {}
    }
    return id;
  }

  function detectDeviceType() {
    var ua = (navigator.userAgent || '').toLowerCase();
    var isTablet = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
    if (!isTablet && navigator.maxTouchPoints > 1 && /macintosh/i.test(ua)) {
      isTablet = true;
    }
    if (isTablet) return 'Tablet';

    var isMobile = /(iphone|ipod|android.*mobile|blackberry|iemobile|opera mini|mobile)/i.test(ua);
    if (isMobile) return 'Mobile';

    return 'Laptop-Desktop';
  }

  function detectBrowser() {
    var ua = navigator.userAgent || '';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/Edg(?:e|A|iOS)?\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
    if (/Chrome|CriOS/i.test(ua)) return 'Chrome';
    if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
    if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) return 'Safari';
    if (/Trident|MSIE/i.test(ua)) return 'Internet Explorer';
    return 'Unknown';
  }

  function usersUrl() {
    return 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + USERS_PATH + '?_=' + Date.now();
  }

  function usersApiUrl() {
    return 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + USERS_PATH + '?ref=' + encodeURIComponent(GH_BRANCH) + '&_=' + Date.now();
  }

  function devicesRawUrl() {
    return 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + DEVICES_PATH + '?_=' + Date.now();
  }

  function devicesApiUrl() {
    return 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + DEVICES_PATH + '?ref=' + encodeURIComponent(GH_BRANCH) + '&_=' + Date.now();
  }

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && typeof s.u === 'string' && s.u ? s : null;
    } catch (e) { return null; }
  }

  function setSession(u, blocked) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        u: u,
        blocked: !!blocked,
        at: Date.now()
      }));
    } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function fetchUsers() {
    var token = getContentsToken();
    if (token) {
      return fetch(usersApiUrl(), {
        cache: 'no-store',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + token
        }
      })
      .then(function (r) {
        if (!r.ok) throw new Error();
        return r.json().then(function (data) {
          if (data && data.content) {
            return JSON.parse(b64DecodeUtf8(data.content));
          }
          throw new Error();
        });
      })
      .catch(function () {
        return fetch(usersUrl(), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      });
    }

    return fetch(usersUrl(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function parseDevicesPayload(data) {
    var max = DEFAULT_MAX_DEVICES;
    var list = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && typeof data === 'object') {
      if (typeof data.maxDevices === 'number') max = data.maxDevices;
      if (Array.isArray(data.devices)) list = data.devices;
      else list = Object.values(data).filter(function (d) { return d && typeof d === 'object' && d.deviceId; });
    }
    return { maxDevices: max, list: list };
  }

  // Resolves to { list: Array, maxDevices: number, sha: string|null }, or null on network error.
  function fetchDevices() {
    var token = getContentsToken();
    var headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    return fetch(devicesApiUrl(), { cache: 'no-store', headers: headers })
      .then(function (r) {
        if (r.status === 404) {
          return { list: [], maxDevices: DEFAULT_MAX_DEVICES, sha: null };
        }
        if (!r.ok) {
          return fetch(devicesRawUrl(), { cache: 'no-store' })
            .then(function (rawR) {
              if (rawR.status === 404) return { list: [], maxDevices: DEFAULT_MAX_DEVICES, sha: null };
              if (!rawR.ok) return null;
              return rawR.json().then(function (json) {
                var parsed = parseDevicesPayload(json);
                return { list: parsed.list, maxDevices: parsed.maxDevices, sha: null };
              });
            })
            .catch(function () { return null; });
        }
        return r.json().then(function (data) {
          var sha = data.sha || null;
          var parsed = { list: [], maxDevices: DEFAULT_MAX_DEVICES };
          if (data && data.content) {
            try {
              var json = JSON.parse(b64DecodeUtf8(data.content));
              parsed = parseDevicesPayload(json);
            } catch (e) {}
          }
          return { list: parsed.list, maxDevices: parsed.maxDevices, sha: sha };
        });
      })
      .catch(function () {
        return fetch(devicesRawUrl(), { cache: 'no-store' })
          .then(function (rawR) {
            if (rawR.status === 404) return { list: [], maxDevices: DEFAULT_MAX_DEVICES, sha: null };
            if (!rawR.ok) return null;
            return rawR.json().then(function (json) {
              var parsed = parseDevicesPayload(json);
              return { list: parsed.list, maxDevices: parsed.maxDevices, sha: null };
            });
          })
          .catch(function () { return null; });
      });
  }

  function saveDevices(list, maxDevices, sha) {
    var token = getContentsToken();
    if (!token) {
      return Promise.resolve(false);
    }
    var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + DEVICES_PATH;
    var payload = {
      maxDevices: typeof maxDevices === 'number' ? maxDevices : DEFAULT_MAX_DEVICES,
      devices: list
    };
    var body = {
      message: 'Update devices.json',
      content: b64EncodeUtf8(JSON.stringify(payload, null, 2)),
      branch: GH_BRANCH
    };
    if (sha) body.sha = sha;

    return fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(function (r) { return r.ok; })
    .catch(function () { return false; });
  }

  function reportNewUsername(username) {
    var token = getIssuesToken();
    if (!token || token.indexOf('PUT_') === 0) return;
    fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/issues', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
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
    var target = String(username || '').trim().toLowerCase();
    var e = null;
    for (var key in users) {
      if (!Object.prototype.hasOwnProperty.call(users, key)) continue;
      if (String(key).trim().toLowerCase() === target) { e = users[key]; break; }
    }
    if (!e) return 'unknown';
    return e.status === 'blocked' ? 'blocked' : 'allowed';
  }

  var on = 0, cssEl = null, boxEl = null;

  function ungate() {
    if (!on) return;
    if (cssEl && cssEl.parentNode) cssEl.parentNode.removeChild(cssEl);
    if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
    on = 0;
    cssEl = null;
    boxEl = null;
  }

  function gate(initialMsg) {
    if (on) {
      if (boxEl && initialMsg) {
        var errEl = boxEl.querySelector('.cg-e');
        if (errEl) errEl.textContent = initialMsg;
      }
      return;
    }
    on = 1;
    var d = document;
    cssEl = d.createElement('style');
    boxEl = d.createElement('div');

    cssEl.textContent =
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

    boxEl.id = 'cashGate';
    boxEl.setAttribute('role', 'dialog');
    boxEl.setAttribute('aria-modal', 'true');
    boxEl.innerHTML =
      '<div class="cg"><div class="cg-i"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1C5EA8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>' +
      '<h1>تسجيل الدخول</h1>' +
      '<p>أدخل اسم المستخدم للمتابعة</p>' +
      '<input type="text" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="64" aria-label="اسم المستخدم">' +
      '<div class="cg-e" role="alert"></div>' +
      '<button type="button">دخول</button></div>';

    function mount() {
      d.head.appendChild(cssEl);
      d.body.appendChild(boxEl);
      var inp = boxEl.getElementsByTagName('input')[0];
      var err = boxEl.querySelector('.cg-e');
      var btn = boxEl.getElementsByTagName('button')[0];

      function note(m) { err.textContent = m; }
      function busy(b) { btn.disabled = b; inp.disabled = b; }

      var sess = getSession();
      if (sess && sess.u && !inp.value) {
        inp.value = sess.u;
      }
      if (initialMsg) note(initialMsg);

      function go() {
        var u = (inp.value || '').trim();
        if (!u) { note('الرجاء إدخال اسم المستخدم'); return; }
        note(''); busy(true);

        fetchUsers().then(function (users) {
          if (users === null) {
            busy(false);
            note('تعذّر الاتصال، حاول مرة أخرى');
            return;
          }
          var st = statusOf(users, u);
          if (st === 'blocked') {
            busy(false);
            note('لا يمكن الدخول بهذا الاسم');
            setSession(u, true);
            watch();
            return;
          }

          fetchDevices().then(function (res) {
            if (res === null) {
              busy(false);
              note('تعذّر التحقق من الجهاز، حاول مرة أخرى');
              return;
            }

            var list = res.list || [];
            var maxAllowed = res.maxDevices || DEFAULT_MAX_DEVICES;
            var sha = res.sha;
            var target = u.toLowerCase();
            var devId = getDeviceId();
            var devType = detectDeviceType();
            var browser = detectBrowser();
            var now = new Date().toISOString();

            var userDevs = list.filter(function (d) {
              return String(d.username || '').trim().toLowerCase() === target;
            });

            var thisDev = userDevs.find(function (d) {
              return String(d.deviceId) === String(devId);
            });

            if (thisDev) {
              // Existing device
              if (thisDev.status === 'disabled' || thisDev.enabled === false) {
                busy(false);
                note('تم تعطيل هذا الجهاز من قبل الإدارة.');
                return;
              }

              thisDev.lastSeen = now;
              thisDev.deviceType = devType;
              thisDev.browser = browser;

              // Existing valid device may continue login even if lastSeen update fails
              saveDevices(list, maxAllowed, sha).catch(function () {
                return false;
              }).then(function () {
                busy(false);
                if (st === 'unknown') reportNewUsername(u);
                setSession(u, false);
                ungate();
                watch();
              });
            } else {
              // New device
              var activeDevs = userDevs.filter(function (d) {
                return d.status !== 'disabled' && d.enabled !== false;
              });

              if (activeDevs.length >= maxAllowed) {
                busy(false);
                note('تم الوصول للحد الأقصى للأجهزة المسموح بها (' + maxAllowed + ' أجهزة). يرجى مراجعة الإدارة.');
                return;
              }

              var exists = list.some(function (d) {
                return String(d.deviceId) === String(devId) &&
                       String(d.username || '').trim().toLowerCase() === target;
              });

              if (!exists) {
                list.push({
                  username: u,
                  deviceId: devId,
                  deviceType: devType,
                  browser: browser,
                  firstSeen: now,
                  lastSeen: now,
                  status: 'enabled',
                  enabled: true
                });
              }

              // If NEW device registration fails to save, do not silently complete registration; show retry/error
              saveDevices(list, maxAllowed, sha).then(function (saved) {
                if (!saved) {
                  busy(false);
                  note('تعذّر تسجيل الجهاز الجديد، يرجى المحاولة مرة أخرى.');
                  return;
                }
                busy(false);
                if (st === 'unknown') reportNewUsername(u);
                setSession(u, false);
                ungate();
                watch();
              });
            }
          });
        });
      }

      btn.addEventListener('click', go);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      setTimeout(function () { inp.focus(); }, 0);
    }

    if (d.body) mount(); else d.addEventListener('DOMContentLoaded', mount);
  }

  // Real-time re-checks users.json and devices.json for revocation or unblocking
  function recheck() {
    var s = getSession();
    if (!s) return;

    fetchUsers().then(function (users) {
      if (users === null) return;
      var st = statusOf(users, s.u);

      if (st === 'blocked') {
        setSession(s.u, true);
        gate('لا يمكن الدخول بهذا الاسم');
        return;
      }

      fetchDevices().then(function (res) {
        if (!res || !res.list) return;
        var target = String(s.u || '').trim().toLowerCase();
        var devId = getDeviceId();
        var dev = res.list.find(function (d) {
          return String(d.deviceId) === String(devId) &&
                 String(d.username || '').trim().toLowerCase() === target;
        });

        if (dev && (dev.status === 'disabled' || dev.enabled === false)) {
          gate('تم تعطيل هذا الجهاز من قبل الإدارة.');
          return;
        }

        // Active user is allowed and device is enabled: ungate if previously gated
        if (st === 'allowed' || st === 'unknown') {
          if (s.blocked) {
            setSession(s.u, false);
          }
          if (on) {
            ungate();
          }
        }
      });
    });
  }

  var timer = null;
  function watch() {
    if (timer) clearInterval(timer);
    timer = setInterval(recheck, RECHECK_MS);
  }

  addEventListener('pageshow', recheck);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });

  var currentSession = getSession();
  if (currentSession) {
    watch();
    if (currentSession.blocked) {
      gate('لا يمكن الدخول بهذا الاسم');
    }
    recheck();
  } else {
    gate();
  }
})();
