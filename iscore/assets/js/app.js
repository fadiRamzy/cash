"use strict";

/* ===================== Config ===================== */
const CONFIG = {
  dataUrl: "data/codes.json",
  ratingUrl: "data/rating.json",
  historyKey: "acq_search_history",
  themeKey: "acq_theme",
  historyLimit: 10,
  version: "1.0.0",
};

const CATEGORY_COLORS = {
  "بنوك عامة": "#1d3a63",
  "بنوك متخصصة": "#2c527f",
  "بنوك تجارية": "#0b1f3a",
  "بنوك استثمارية": "#5a3ea3",
  "بنوك أجنبية": "#1e6f7a",
  "شركات ائتمان استهلاكي": "#b23b3b",
  "شركات ائتمان وتقسيط": "#c07a12",
  "تمويل متناهي الصغر وجمعيات": "#1e8f5f",
  "شركات تمويل عقاري": "#8a5a1e",
  "شركات تأجير تمويلي": "#3b6ea5",
  "شركات إسكان وتعمير": "#7a5230",
  "خدمات مالية غير مصرفية": "#6b4ea3",
  "هيئات ومؤسسات أخرى": "#54606f",
  "جهات رقابية": "#0b1f3a",
  "شركات مرافق": "#2a7a6b",
  "أخرى": "#6b7280",
};

/* ===================== State ===================== */
const state = {
  records: [],
  activeCategory: null,
  history: [],
  index: [],
};

/* ===================== Utilities ===================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function normalize(str) {
  return (str || "")
    .toString()
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const nText = normalize(text);
  const nQuery = normalize(query);
  const idx = nText.indexOf(nQuery);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    "<mark>" + escapeHtml(text.slice(idx, idx + nQuery.length)) + "</mark>" +
    escapeHtml(text.slice(idx + nQuery.length));
}

/* ===================== Data loading ===================== */
async function loadData() {
  const [codesRes, ratingRes] = await Promise.all([
    fetch(CONFIG.dataUrl), fetch(CONFIG.ratingUrl),
  ]);
  const codes = await codesRes.json();
  const rating = await ratingRes.json();
  state.records = codes.records;
  state.index = state.records.map((r) => ({
    ...r,
    nName: normalize(r.name),
    nCode: normalize(r.code),
  }));
  $("#total-records").textContent = codes.totalRecords.toLocaleString("ar-EG");
  $("#last-update").textContent = codes.generatedAt;
  $("#footer-version").textContent = CONFIG.version;
  $("#footer-updated").textContent = codes.generatedAt;
  $("#footer-total").textContent = codes.totalRecords.toLocaleString("ar-EG");
  renderCategoryChips();
  renderRatingTable(rating.bands);
  renderMeter(rating.bands);
}

/* ===================== Search engine ===================== */
function search(query, category) {
  const nQuery = normalize(query);
  const t0 = performance.now();
  let pool = state.index;
  if (category) pool = pool.filter((r) => r.category === category);
  let results;
  if (!nQuery) {
    results = pool;
  } else {
    const scored = [];
    for (const r of pool) {
      let score = -1;
      if (r.nCode === nQuery || r.nName === nQuery) score = 100;
      else if (r.nCode.startsWith(nQuery) || r.nName.startsWith(nQuery)) score = 80;
      else if (r.nCode.includes(nQuery) || r.nName.includes(nQuery)) score = 60;
      if (score > 0) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name, "ar"));
    results = scored.map((s) => s.r);
  }
  const elapsed = (performance.now() - t0).toFixed(1);
  return { results, elapsed };
}

/* ===================== Rendering ===================== */
function renderCategoryChips() {
  const categories = [...new Set(state.records.map((r) => r.category))].sort(
    (a, b) => a.localeCompare(b, "ar")
  );
  const wrap = $("#category-chips");
  wrap.innerHTML =
    `<button class="chip active" data-cat="">الكل</button>` +
    categories
      .map((c) => `<button class="chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join("");
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    $$(".chip", wrap).forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.activeCategory = btn.dataset.cat || null;
    runSearch();
  });
}

function renderResults(query) {
  const list = $("#results-list");

  if (!query.trim()) {
    $("#result-count").textContent = "0";
    $("#search-time").textContent = "0";
    list.innerHTML = "";
    return;
  }

  const { results, elapsed } = search(query, state.activeCategory);
  $("#result-count").textContent = results.length.toLocaleString("ar-EG");
  $("#search-time").textContent = elapsed;

  if (results.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4" stroke-linecap="round"/><path d="M8 11h6" stroke-linecap="round"/></svg>
        <h3>لا توجد نتائج مطابقة</h3>
        <p>تحقق من الإملاء أو جرّب كودًا أو جزءًا آخر من الاسم.</p>
      </div>`;
    return;
  }

  const limited = results.slice(0, 200);
  list.innerHTML = limited
    .map((r) => {
      const color = CATEGORY_COLORS[r.category] || "#6b7280";
      const initials = r.category.slice(0, 2);
      return `
      <div class="result-card">
        <div class="result-badge" style="background:linear-gradient(155deg, ${color}, #0b1f3a)">${escapeHtml(initials)}</div>
        <div class="result-body">
          <div class="result-name">${highlight(r.name, query)}</div>
          <div class="result-meta">
            <span class="result-code">${highlight(r.code, query)}</span>
            <span>${escapeHtml(r.category)}</span>
          </div>
        </div>
        <div class="result-actions">
          <button class="mini-btn" data-copy="${escapeHtml(r.code)}" title="نسخ الكود" aria-label="نسخ الكود">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          </button>
          <button class="mini-btn" data-copy="${escapeHtml(r.name)}" title="نسخ الاسم" aria-label="نسخ الاسم">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`;
    })
    .join("");
}

function renderMeter(bands) {
  const track = $("#meter-track");
  const scale = $("#meter-scale");
  const legend = $("#meter-legend");
  const min = Math.min(...bands.map((b) => b.min));
  const max = Math.max(...bands.map((b) => b.max));
  const span = max - min;
  const sorted = [...bands].sort((a, b) => b.min - a.min);

  track.innerHTML = sorted
    .map((b) => {
      const width = ((b.max - b.min + 1) / (span + 1)) * 100;
      const color = ratingColor(b.rating);
      return `<div class="meter-band" style="flex:${width} 1 0;background:${color}" data-tip="${escapeHtml(b.rating)} · ${b.min}-${b.max} · مخاطر ${b.riskRate}%">${b.min}-${b.max}</div>`;
    })
    .join("");

  scale.innerHTML = `<span>${min}</span><span>مقياس الجدارة الائتمانية</span><span>${max}</span>`;

  legend.innerHTML = sorted
    .map(
      (b) =>
        `<div class="legend-item"><span class="legend-dot" style="background:${ratingColor(b.rating)}"></span>${escapeHtml(b.rating)} · نسبة مخاطر ${b.riskRate}%</div>`
    )
    .join("");

  const tooltip = $("#meter-tooltip");
  $$(".meter-band", track).forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      tooltip.textContent = el.dataset.tip;
      tooltip.style.left = e.clientX + 14 + "px";
      tooltip.style.top = e.clientY + 14 + "px";
      tooltip.classList.add("show");
    });
    el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
  });
}

function ratingColor(rating) {
  const map = {
    "ممتاز": "#1e8f5f",
    "جيد جدا": "#4fa876",
    "مرضي": "#c9a227",
    "غير مرضي": "#c07a12",
    "مخاطر مرتفعه": "#b25a2f",
    "متعثر": "#b23b3b",
  };
  return map[rating] || "#6b7280";
}

function renderRatingTable(bands) {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const tbody = $("#rating-tbody");
  const draw = (rows) => {
    tbody.innerHTML = rows
      .map(
        (b) => `<tr>
          <td><span class="rating-pill" style="background:${ratingColor(b.rating)}">${escapeHtml(b.rating)}</span></td>
          <td>${b.min}</td>
          <td>${b.max}</td>
        </tr>`
      )
      .join("");
  };
  draw(sorted);
  $("#rating-search").addEventListener("input", (e) => {
    const raw = e.target.value.trim();
    const asNumber = Number(raw);
    if (raw !== "" && !isNaN(asNumber)) {
      draw(sorted.filter((b) => asNumber >= b.min && asNumber <= b.max));
    } else {
      const q = normalize(raw);
      draw(sorted.filter((b) => normalize(b.rating).includes(q)));
    }
  });
}

/* ===================== History ===================== */
function loadHistory() {
  try {
    state.history = JSON.parse(localStorage.getItem(CONFIG.historyKey)) || [];
  } catch {
    state.history = [];
  }
  renderHistory();
}
function pushHistory(term) {
  if (!term.trim()) return;
  state.history = [term, ...state.history.filter((h) => h !== term)].slice(0, CONFIG.historyLimit);
  localStorage.setItem(CONFIG.historyKey, JSON.stringify(state.history));
  renderHistory();
}
function renderHistory() {
  const wrap = $("#history-row");
  const clearBtn = $("#clear-history");
  if (state.history.length === 0) {
    wrap.innerHTML = `<span style="font-size:12.5px;color:var(--text-3)">لا توجد عمليات بحث سابقة</span>`;
    clearBtn.style.display = "none";
    return;
  }
  clearBtn.style.display = "inline";
  wrap.innerHTML = state.history
    .map((h) => `<button class="history-chip" data-term="${escapeHtml(h)}">${escapeHtml(h)}</button>`)
    .join("");
}

/* ===================== Theme ===================== */
function initTheme() {
  const saved = localStorage.getItem(CONFIG.themeKey);
  const preferred = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", preferred);
  updateThemeIcon(preferred);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(CONFIG.themeKey, next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  $("#theme-toggle").innerHTML =
    theme === "dark"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" stroke-linecap="round"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>`;
}

/* ===================== Toasts ===================== */
function toast(message) {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`تم نسخ "${text}"`);
  } catch {
    toast("تعذر النسخ، جرّب يدويًا");
  }
}

/* ===================== Export ===================== */
/* ===================== Search orchestration ===================== */
const runSearch = debounce(() => {
  const query = $("#search-input").value;
  renderResults(query);
}, 90);

function initSearchUi() {
  const input = $("#search-input");
  input.addEventListener("input", runSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pushHistory(input.value);
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) pushHistory(input.value.trim());
  });

  $("#history-row").addEventListener("click", (e) => {
    const btn = e.target.closest(".history-chip");
    if (!btn) return;
    input.value = btn.dataset.term;
    runSearch();
    input.focus();
  });
  $("#clear-history").addEventListener("click", () => {
    state.history = [];
    localStorage.removeItem(CONFIG.historyKey);
    renderHistory();
  });

  $("#results-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copyText(btn.dataset.copy);
  });

  $("#theme-toggle").addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
    if (e.key === "Escape" && document.activeElement === input) {
      input.value = "";
      runSearch();
    }
  });
}

/* ===================== Init ===================== */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSearchUi();
  loadHistory();
  await loadData();
  renderResults("");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
