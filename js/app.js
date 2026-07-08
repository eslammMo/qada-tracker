"use strict";

/* ═══════════════════ الثوابت ═══════════════════ */

const STORAGE_KEY = "qada-state-v1";
const HIJRI_YEAR_DAYS = 354;
const GREGORIAN_YEAR_DAYS = 365;
const MONTH_DAYS = 30;
const LOG_RETENTION_DAYS = 90;

const THEME_KEY = "qada-theme";
const REMINDER_KEY = "qada-reminder";
const LAST_EXPORT_KEY = "qada-last-export";
const BACKUP_SNOOZE_KEY = "qada-backup-nag";
const REMINDER_SHOWN_KEY = "qada-reminder-shown";

const PRAYERS = [
  { id: "fajr" }, { id: "dhuhr" }, { id: "asr" }, { id: "maghrib" }, { id: "isha" },
];
const prayerName = (id) => t(`prayer.${id}`);

/* ─── مُنسِّقات تتبع اللغة الحالية ─── */
let num, gregDateFmt, hijriDateFmt, weekdayFmt, percentSign;

function makeFormatters() {
  const ar = getLang() === "ar";
  const locale = ar ? "ar-EG" : "en-GB";
  const numFmt = new Intl.NumberFormat(locale);
  num = (n) => numFmt.format(n);
  gregDateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });
  hijriDateFmt = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, { day: "numeric", month: "long", year: "numeric" });
  weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
  percentSign = ar ? "٪" : "%";
}
makeFormatters();

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayKey = () => dateKey(new Date());

function daysWord(n) {
  if (n === 1) return t("days.one");
  if (n === 2) return t("days.two");
  return t(n <= 10 ? "days.few" : "days.many", { n: num(n) });
}

const MOTIVATION_COUNT = 10;

/* ═══════════════════ الحالة والتخزين ═══════════════════ */

let state = null;

function emptyCounts() {
  return { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.totals || !parsed.done) {
      throw new Error("بنية غير صالحة");
    }
    // ترقية من الإصدار ١: هدف افتراضي ٥ صلوات يوميًا
    if (parsed.goal === undefined) parsed.goal = 5;
    return sanitize(parsed);
  } catch (err) {
    // لا نمسح البيانات التالفة — نحتفظ بها كنسخة للفحص اليدوي
    localStorage.setItem("backup-corrupt-" + Date.now(), raw);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/* كل تعديل يمر من هنا: تحقّق ← تقييد ← حفظ ← عرض ← أوسمة */
function update(mutator) {
  mutator(state);
  state = sanitize(state);
  const newBadges = newlyEarnedMilestones();
  if (newBadges.length) state.celebrated.push(...newBadges);
  persist();
  renderMain();
  if (newBadges.length) showMilestone(newBadges[0]);
}

function sanitize(s) {
  const clean = {
    version: 3,
    calendar: s.calendar === "gregorian" ? "gregorian" : "hijri",
    totals: emptyCounts(),
    done: emptyCounts(),
    fasting: { total: toSafeInt(s.fasting?.total), done: 0 },
    goal: Math.min(toSafeInt(s.goal), 1000),
    log: {},
    celebrated: [],
    updatedAt: Date.now(),
  };
  for (const { id } of PRAYERS) {
    const total = toSafeInt(s.totals?.[id]);
    const done = toSafeInt(s.done?.[id]);
    clean.totals[id] = total;
    clean.done[id] = Math.min(done, total); // لا يتجاوز المنجز المطلوب أبدًا
  }
  clean.fasting.done = Math.min(toSafeInt(s.fasting?.done), clean.fasting.total);
  // سجل الأيام: تواريخ صالحة فقط، وخلال آخر ٩٠ يومًا
  if (s.log && typeof s.log === "object") {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);
    const cutoff = dateKey(cutoffDate);
    for (const [k, v] of Object.entries(s.log)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k < cutoff) continue;
      const p = toSafeInt(v && v.p);
      const f = toSafeInt(v && v.f);
      if (p > 0 || f > 0) clean.log[k] = { p, f };
    }
  }
  if (Array.isArray(s.celebrated)) {
    clean.celebrated = s.celebrated.filter((id) => MILESTONES.some((m) => m.id === id));
  }
  return clean;
}

// تسجيل ما أُنجز اليوم (p = صلوات، f = صيام) — التراجع يخفّض سجل اليوم أيضًا
function logAdd(s, kind, applied) {
  if (applied === 0) return;
  const k = todayKey();
  const entry = s.log[k] || { p: 0, f: 0 };
  entry[kind] = Math.max(0, entry[kind] + applied);
  s.log[k] = entry;
}

function toSafeInt(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : 0;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  writeReminderMeta();
}

// حفظ إضافي عند مغادرة الصفحة (احتياط)
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state) persist();
});

/* ═══════════════════ الأوسمة ═══════════════════ */

function totalDoneAll(s) {
  let sum = 0;
  for (const { id } of PRAYERS) sum += s.done[id];
  return sum;
}
function overallPercent(s) {
  let total = 0, done = 0;
  for (const { id } of PRAYERS) { total += s.totals[id]; done += s.done[id]; }
  return total > 0 ? (done / total) * 100 : 0;
}

const MILESTONES = [
  { id: "p100",  emoji: "🌱", test: (s) => totalDoneAll(s) >= 100 },
  { id: "p500",  emoji: "🌿", test: (s) => totalDoneAll(s) >= 500 },
  { id: "p1000", emoji: "🌳", test: (s) => totalDoneAll(s) >= 1000 },
  { id: "p5000", emoji: "⭐", test: (s) => totalDoneAll(s) >= 5000 },
  { id: "q25",   emoji: "🥉", test: (s) => overallPercent(s) >= 25 },
  { id: "q50",   emoji: "🥈", test: (s) => overallPercent(s) >= 50 },
  { id: "q75",   emoji: "🥇", test: (s) => overallPercent(s) >= 75 },
  { id: "q100",  emoji: "🏆", test: (s) => overallPercent(s) >= 100 && totalDoneAll(s) > 0 },
  { id: "s7",    emoji: "🔥", test: (s) => computeStreak(s.log) >= 7 },
  { id: "s30",   emoji: "🌙", test: (s) => computeStreak(s.log) >= 30 },
  { id: "fast",  emoji: "🕋", test: (s) => s.fasting.total > 0 && s.fasting.done >= s.fasting.total },
];

function newlyEarnedMilestones() {
  return MILESTONES
    .filter((m) => m.test(state) && !state.celebrated.includes(m.id))
    .map((m) => m.id);
}

function showMilestone(id) {
  const m = MILESTONES.find((x) => x.id === id);
  if (!m) return;
  $("milestone-emoji").textContent = m.emoji;
  $("milestone-name").textContent = t(`badge.${id}`);
  if (navigator.vibrate) navigator.vibrate([30, 60, 30, 60, 120]);
  $("milestone-dialog").showModal();
}

function renderBadges() {
  const grid = $("badges-grid");
  grid.innerHTML = "";
  for (const m of MILESTONES) {
    const earned = state.celebrated.includes(m.id);
    const div = document.createElement("div");
    div.className = "badge-item" + (earned ? " earned" : "");
    div.innerHTML = `<span class="badge-emoji">${m.emoji}</span><span class="badge-name">${t(`badge.${m.id}`)}</span>`;
    grid.appendChild(div);
  }
}

/* ═══════════════════ العناصر ═══════════════════ */

const $ = (id) => document.getElementById(id);

const views = {
  setup: $("view-setup"),
  main: $("view-main"),
  settings: $("view-settings"),
  help: $("view-help"),
};

let currentView = "setup";

function showView(name) {
  currentView = name;
  for (const key of Object.keys(views)) views[key].hidden = key !== name;
  $("btn-settings").hidden = name !== "main";
  $("btn-help").hidden = name !== "main";
  $("btn-back").hidden = name === "main" || (name === "setup" && !state);
  if (name === "main") renderMain();
  if (name === "settings") renderSettingsInputs();
}

/* ═══════════════════ اللغة والمظهر ═══════════════════ */

function applyLang(lang) {
  if (lang) localStorage.setItem(LANG_KEY, lang);
  const isAr = getLang() === "ar";
  document.documentElement.lang = isAr ? "ar" : "en";
  document.documentElement.dir = isAr ? "rtl" : "ltr";
  document.title = isAr ? "قضاء الصلوات" : "Qada Prayers";
  makeFormatters();
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", t(el.dataset.i18nTitle));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  markPrefTabs();
  setMotivation();
  if (state) {
    buildPrayerCards();
    renderMain();
    if (currentView === "settings") renderSettingsInputs();
  }
  updateSetupPreview();
}

function applyTheme(choice) {
  if (choice === "light" || choice === "dark") {
    localStorage.setItem(THEME_KEY, choice);
    document.documentElement.dataset.theme = choice;
  } else {
    localStorage.removeItem(THEME_KEY);
    delete document.documentElement.dataset.theme;
  }
  const dark = document.documentElement.dataset.theme === "dark"
    || (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#101817" : "#0f766e");
  markPrefTabs();
}

function markPrefTabs() {
  const theme = localStorage.getItem(THEME_KEY) || "system";
  document.querySelectorAll("#theme-tabs .tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeChoice === theme);
  });
  const lang = getLang();
  document.querySelectorAll("#lang-tabs .tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.langChoice === lang);
  });
}

document.querySelectorAll("#theme-tabs .tab-btn").forEach((b) => {
  b.addEventListener("click", () => applyTheme(b.dataset.themeChoice));
});
document.querySelectorAll("#lang-tabs .tab-btn").forEach((b) => {
  b.addEventListener("click", () => applyLang(b.dataset.langChoice));
});

/* ═══════════════════ شاشة الإعداد ═══════════════════ */

function readSetupInputs() {
  const years = toSafeInt($("in-years").value);
  const months = toSafeInt($("in-months").value);
  const days = toSafeInt($("in-days").value);
  const calendar = document.querySelector('input[name="calendar"]:checked').value;
  const yearDays = calendar === "gregorian" ? GREGORIAN_YEAR_DAYS : HIJRI_YEAR_DAYS;
  return { years, months, days, calendar, totalDays: years * yearDays + months * MONTH_DAYS + days };
}

function updateLeapNote() {
  const { years, calendar } = readSetupInputs();
  const el = $("leap-note");
  if (calendar !== "gregorian") {
    el.hidden = true;
    return;
  }
  // أقصى عدد سنوات كبيسة يمكن أن تقع داخل N سنة متتالية = ceil(N / 4)
  const maxExtraDays = Math.ceil(years / 4);
  el.hidden = false;
  el.textContent = maxExtraDays > 0
    ? t("setup.leapNote", { years: num(years), days: daysWord(maxExtraDays) })
    : t("setup.leapNote0");
}

function updateSetupPreview() {
  updateLeapNote();
  const { totalDays } = readSetupInputs();
  const el = $("setup-preview");
  if (totalDays > 0) {
    el.hidden = false;
    el.textContent = t("setup.preview", { count: num(totalDays), total: num(totalDays * 5) });
  } else {
    el.hidden = true;
  }
}

$("setup-form").addEventListener("input", updateSetupPreview);
$("setup-form").addEventListener("change", updateSetupPreview);

$("setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const { totalDays, calendar } = readSetupInputs();
  if (totalDays <= 0) {
    showToast(t("setup.positive"));
    return;
  }
  const previous = state;
  state = sanitize({
    calendar,
    totals: { fajr: totalDays, dhuhr: totalDays, asr: totalDays, maghrib: totalDays, isha: totalDays },
    done: previous ? previous.done : emptyCounts(), // إعادة الحساب لا تمسح ما أنجزته
    fasting: previous ? previous.fasting : undefined,
    goal: previous ? previous.goal : 5,
    log: previous ? previous.log : undefined,
    celebrated: previous ? previous.celebrated : undefined,
  });
  persist();
  buildPrayerCards();
  showView("main");
  maybeStartTour();
});

/* ═══════════════════ الشاشة الرئيسية ═══════════════════ */

const cardEls = {}; // { fajr: {count, fill, inc, dec, bulk, actions, badge}, ... }

function buildPrayerCards() {
  const list = $("prayer-list");
  list.innerHTML = "";
  for (const { id } of PRAYERS) {
    const name = prayerName(id);
    const card = document.createElement("div");
    card.className = "card prayer-card";
    card.style.setProperty("--p-color", `var(--c-${id})`);
    card.innerHTML = `
      <div class="prayer-top">
        <span class="prayer-name">${name}</span>
        <span class="prayer-count"><span class="done-num"></span> / <span class="total-num"></span></span>
      </div>
      <div class="progress-track"><div class="progress-fill"></div></div>
      <div class="prayer-actions">
        <button class="btn-inc">${t("btn.inc")}</button>
        <button class="btn-small btn-bulk">${t("btn.bulk")}</button>
        <button class="btn-small btn-dec">${t("btn.dec")}</button>
      </div>
      <div class="prayer-complete-badge" hidden>${t("card.complete")}</div>
    `;
    const els = {
      done: card.querySelector(".done-num"),
      total: card.querySelector(".total-num"),
      count: card.querySelector(".prayer-count"),
      fill: card.querySelector(".progress-fill"),
      inc: card.querySelector(".btn-inc"),
      dec: card.querySelector(".btn-dec"),
      bulk: card.querySelector(".btn-bulk"),
      actions: card.querySelector(".prayer-actions"),
      badge: card.querySelector(".prayer-complete-badge"),
    };
    els.inc.addEventListener("click", () => addDone(id, 1));
    els.dec.addEventListener("click", () => addDone(id, -1));
    els.bulk.addEventListener("click", () => openBulkDialog("prayer", id, name));
    cardEls[id] = els;
    list.appendChild(card);
  }
}

function addDone(id, delta) {
  let applied = 0;
  const wasComplete = state.done[id] >= state.totals[id] && state.totals[id] > 0;
  update((s) => {
    const next = Math.max(0, Math.min(s.done[id] + delta, s.totals[id]));
    applied = next - s.done[id];
    s.done[id] = next;
    logAdd(s, "p", applied);
  });
  if (applied !== 0 && cardEls[id]) {
    bumpAnim(cardEls[id].count);
    if (navigator.vibrate) navigator.vibrate(delta > 0 ? 15 : [10, 40, 10]);
    const nowComplete = state.done[id] >= state.totals[id] && state.totals[id] > 0;
    if (!wasComplete && nowComplete) celebrate(cardEls[id].count.closest(".prayer-card"));
  }
  return applied;
}

function addFasting(delta) {
  let applied = 0;
  const wasComplete = state.fasting.done >= state.fasting.total && state.fasting.total > 0;
  update((s) => {
    const next = Math.max(0, Math.min(s.fasting.done + delta, s.fasting.total));
    applied = next - s.fasting.done;
    s.fasting.done = next;
    logAdd(s, "f", applied);
  });
  if (applied !== 0) {
    bumpAnim($("fasting-count"));
    if (navigator.vibrate) navigator.vibrate(delta > 0 ? 15 : [10, 40, 10]);
    const nowComplete = state.fasting.done >= state.fasting.total && state.fasting.total > 0;
    if (!wasComplete && nowComplete) celebrate($("fasting-card"));
  }
  return applied;
}

function bumpAnim(el) {
  el.classList.remove("bump");
  void el.offsetWidth; // إعادة تشغيل الحركة
  el.classList.add("bump");
}

function celebrate(card) {
  if (!card) return;
  card.classList.add("celebrate");
  if (navigator.vibrate) navigator.vibrate([30, 60, 30, 60, 80]);
  setTimeout(() => card.classList.remove("celebrate"), 1200);
}

function renderMain() {
  if (!state) return;
  let totalAll = 0;
  let doneAll = 0;
  for (const { id } of PRAYERS) {
    const total = state.totals[id];
    const done = state.done[id];
    totalAll += total;
    doneAll += done;
    const els = cardEls[id];
    if (!els) continue;
    els.done.textContent = num(done);
    els.total.textContent = num(total);
    els.fill.style.width = total > 0 ? `${(done / total) * 100}%` : "0%";
    const complete = total > 0 && done >= total;
    els.inc.disabled = complete;
    els.bulk.disabled = complete;
    els.dec.disabled = done === 0;
    els.actions.hidden = complete;
    els.badge.hidden = !complete;
  }
  const percent = totalAll > 0 ? (doneAll / totalAll) * 100 : 0;
  $("overall-percent").textContent = num(Math.floor(percent)) + percentSign;
  $("overall-done").textContent = num(doneAll);
  $("overall-remaining").textContent = num(totalAll - doneAll);
  const CIRC = 263.9;
  $("ring-progress").style.strokeDashoffset = String(CIRC - (CIRC * percent) / 100);
  $("btn-day-done").disabled = doneAll >= totalAll;
  renderFasting();
  updateAppBadge();
  if (!views.main.hidden && !$("tab-stats").hidden) renderStats();
}

/* شارة أيقونة التطبيق: المتبقي من هدف اليوم */
function updateAppBadge() {
  if (!("setAppBadge" in navigator)) return;
  const today = state.log[todayKey()] || { p: 0 };
  const remaining = state.goal > 0 ? Math.max(0, state.goal - today.p) : 0;
  if (remaining > 0) navigator.setAppBadge(remaining).catch(() => {});
  else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
}

/* ═══════════════════ التبويبات ═══════════════════ */

const TAB_NAMES = ["prayers", "fasting", "stats"];

function showTab(name) {
  for (const tab of TAB_NAMES) {
    $("tab-" + tab).hidden = tab !== name;
    $("tab-btn-" + tab).classList.toggle("active", tab === name);
  }
  if (name === "stats") renderStats();
}

for (const tab of TAB_NAMES) {
  $("tab-btn-" + tab).addEventListener("click", () => showTab(tab));
}

/* ═══════════════════ زر اليوم الكامل ═══════════════════ */

$("btn-day-done").addEventListener("click", () => {
  const incremented = [];
  update((s) => {
    for (const { id } of PRAYERS) {
      if (s.done[id] < s.totals[id]) {
        s.done[id] += 1;
        incremented.push(id);
        logAdd(s, "p", 1);
      }
    }
  });
  if (incremented.length === 0) return;
  if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
  const msg = incremented.length === 5
    ? t("dayDone.full")
    : t("dayDone.partial", { n: num(incremented.length) });
  showToast(msg, () => {
    update((s) => {
      for (const id of incremented) {
        if (s.done[id] > 0) {
          s.done[id] -= 1;
          logAdd(s, "p", -1);
        }
      }
    });
  });
});

/* ═══════════════════ الصيام ═══════════════════ */

function renderFasting() {
  const { total, done } = state.fasting;
  $("fasting-empty").hidden = total > 0;
  $("fasting-card").hidden = total === 0;
  if (total === 0) return;
  $("fasting-done").textContent = num(done);
  $("fasting-total").textContent = num(total);
  $("fasting-fill").style.width = `${(done / total) * 100}%`;
  const complete = done >= total;
  $("fasting-inc").disabled = complete;
  $("fasting-bulk").disabled = complete;
  $("fasting-dec").disabled = done === 0;
  $("fasting-actions").hidden = complete;
  $("fasting-badge").hidden = !complete;
}

$("fasting-setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const days = toSafeInt($("fasting-days-input").value);
  if (days <= 0) return;
  update((s) => { s.fasting.total = days; });
  $("fasting-days-input").value = "";
});

$("fasting-inc").addEventListener("click", () => addFasting(1));
$("fasting-dec").addEventListener("click", () => addFasting(-1));
$("fasting-bulk").addEventListener("click", () => openBulkDialog("fasting", null, t("prayer.fastingName")));

/* ═══════════════════ الإحصائيات ═══════════════════ */

function hasActivity(log, key) {
  const e = log[key];
  return Boolean(e && (e.p > 0 || e.f > 0));
}

function computeStreak(log) {
  const d = new Date();
  // عدم إنجاز شيء اليوم لا يكسر السلسلة قبل انتهاء اليوم
  if (!hasActivity(log, dateKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (hasActivity(log, dateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function estimateText() {
  let remaining = 0;
  for (const { id } of PRAYERS) remaining += state.totals[id] - state.done[id];
  if (remaining === 0) return t("stats.estimateDone");
  let rate = state.goal;
  let basis = t("stats.basisGoal");
  if (rate <= 0) {
    let sum = 0;
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      const e = state.log[dateKey(d)];
      if (e) sum += e.p;
      d.setDate(d.getDate() - 1);
    }
    rate = sum / 7;
    basis = t("stats.basisAvg");
  }
  if (rate <= 0) return t("stats.estimateNone");
  const days = Math.ceil(remaining / rate);
  const end = new Date();
  end.setDate(end.getDate() + days);
  return t("stats.estimate", {
    basis,
    days: daysWord(days),
    hijri: hijriDateFmt.format(end),
    greg: gregDateFmt.format(end),
  });
}

function renderStats() {
  if (!state) return;
  const today = state.log[todayKey()] || { p: 0, f: 0 };
  $("today-value").textContent = num(today.p);
  $("streak-value").textContent = num(computeStreak(state.log));

  const goal = state.goal;
  if (goal > 0) {
    const met = today.p >= goal;
    $("goal-status").textContent = t(met ? "stats.goalMet" : "stats.goalProgress", { done: num(today.p), goal: num(goal) });
    $("goal-fill").style.width = `${Math.min(100, (today.p / goal) * 100)}%`;
    $("goal-card").classList.toggle("goal-met", met);
  } else {
    $("goal-status").textContent = t("stats.goalNone");
    $("goal-fill").style.width = "0%";
    $("goal-card").classList.remove("goal-met");
  }

  $("estimate-text").textContent = estimateText();
  renderBadges();
  buildChart();
}

/* مخطط آخر ١٤ يومًا — SVG بلا مكتبات، الأحدث في نهاية اتجاه القراءة */
function buildChart() {
  const wrap = $("chart-wrap");
  const days = [];
  const d = new Date();
  d.setDate(d.getDate() - 13);
  for (let i = 0; i < 14; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  const values = days.map((dt) => (state.log[dateKey(dt)] || { p: 0 }).p);
  if (values.every((v) => v === 0)) {
    wrap.innerHTML = `<p class="hint-text chart-empty">${t("stats.chartEmpty")}</p>`;
    return;
  }
  const W = 340, H = 150, top = 18, bottom = 24, left = 8, right = 8;
  const plotW = W - left - right, plotH = H - top - bottom;
  const goal = state.goal;
  const max = Math.max(...values, goal, 4);
  const slot = plotW / 14;
  const barW = Math.min(slot - 3, 18);
  let svg = "";
  if (goal > 0 && goal <= max) {
    const gy = top + plotH - (goal / max) * plotH;
    svg += `<line x1="${left}" y1="${gy}" x2="${left + plotW}" y2="${gy}" class="chart-goal-line"/>`
      + `<text x="${left + plotW}" y="${gy - 4}" text-anchor="end" class="chart-goal-label">${t("stats.chartGoal", { n: num(goal) })}</text>`;
  }
  days.forEach((dt, i) => {
    const v = values[i];
    const cx = left + (i + 0.5) * slot;
    const x = cx - barW / 2;
    const isToday = i === 13;
    const title = `<title>${weekdayFmt.format(dt)} ${gregDateFmt.format(dt)}: ${num(v)}</title>`;
    if (v === 0) {
      svg += `<rect x="${x}" y="${top + plotH - 2}" width="${barW}" height="2" class="chart-bar-empty">${title}</rect>`;
    } else {
      const h = (v / max) * plotH;
      const y = top + plotH - h;
      const r = Math.min(4, barW / 2, h);
      svg += `<path d="M${x},${top + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z" class="chart-bar${isToday ? " today" : ""}">${title}</path>`;
      if (isToday) svg += `<text x="${cx}" y="${y - 5}" text-anchor="middle" class="chart-value">${num(v)}</text>`;
    }
    if (i % 3 === 1) {
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="chart-day">${isToday ? t("stats.chartToday") : num(dt.getDate())}</text>`;
    }
  });
  svg += `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="chart-baseline"/>`;
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("stats.chartAria")}">${svg}</svg>`;
}

/* ═══════════════════ الإضافة المخصصة ═══════════════════ */

const bulkDialog = $("bulk-dialog");
let bulkTarget = null; // { kind: "prayer", id } أو { kind: "fasting" }

function openBulkDialog(kind, id, name) {
  bulkTarget = { kind, id };
  $("bulk-title").textContent = t("bulk.title", { name });
  const remaining = kind === "fasting"
    ? state.fasting.total - state.fasting.done
    : state.totals[id] - state.done[id];
  const input = $("bulk-count");
  input.max = String(remaining);
  input.value = String(Math.min(5, remaining));
  bulkDialog.showModal();
  input.select();
}

bulkDialog.addEventListener("close", () => {
  if (bulkDialog.returnValue !== "ok" || !bulkTarget) return;
  const { kind, id } = bulkTarget;
  bulkTarget = null;
  const requested = toSafeInt($("bulk-count").value);
  if (requested <= 0) return;
  const apply = (n) => (kind === "fasting" ? addFasting(n) : addDone(id, n));
  const applied = apply(requested);
  if (applied <= 0) return;
  const msg = applied < requested
    ? t("toast.addedOnly", { n: num(applied) })
    : t(kind === "fasting" ? "toast.addedDays" : "toast.addedPrayers", { n: num(applied) });
  showToast(msg, () => apply(-applied));
});

/* ═══════════════════ الإعدادات ═══════════════════ */

$("btn-settings").addEventListener("click", () => showView("settings"));
$("btn-back").addEventListener("click", () => showView("main"));

function renderSettingsInputs() {
  const grid = $("totals-inputs");
  grid.innerHTML = "";
  const addField = (id, name, doneCount, totalValue, color) => {
    const label = document.createElement("label");
    label.className = "field";
    label.style.setProperty("--p-color", color);
    label.innerHTML = `<span>${name} ${t("settings.doneCount", { n: num(doneCount) })}</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.id = `total-${id}`;
    input.value = String(totalValue);
    label.appendChild(input);
    grid.appendChild(label);
  };
  for (const { id } of PRAYERS) {
    addField(id, prayerName(id), state.done[id], state.totals[id], `var(--c-${id})`);
  }
  addField("fasting", t("prayer.fastingName"), state.fasting.done, state.fasting.total, "var(--c-fasting)");

  $("goal-input").value = String(state.goal);
  renderReminderControls();
}

$("totals-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const newTotals = {};
  let clamped = false;
  for (const { id } of PRAYERS) {
    newTotals[id] = toSafeInt($(`total-${id}`).value);
    if (newTotals[id] < state.done[id]) clamped = true;
  }
  const newFastingTotal = toSafeInt($("total-fasting").value);
  if (newFastingTotal < state.fasting.done) clamped = true;
  if (clamped && !confirm(t("settings.clampConfirm"))) {
    return;
  }
  update((s) => {
    s.totals = newTotals;
    s.fasting.total = newFastingTotal;
  });
  showToast(t("settings.saved"));
  showView("main");
});

$("btn-recalc").addEventListener("click", () => showView("setup"));

$("goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  update((s) => { s.goal = Math.min(toSafeInt($("goal-input").value), 1000); });
  showToast(t("settings.goalSaved"));
  showView("main");
  showTab("stats");
});

/* ═══ التذكير اليومي ═══ */

function renderReminderControls() {
  const enabled = Boolean(localStorage.getItem(REMINDER_KEY));
  if (enabled) $("reminder-time").value = localStorage.getItem(REMINDER_KEY);
  $("btn-reminder").textContent = t(enabled ? "settings.reminderDisable" : "settings.reminderEnable");
  $("btn-reminder").classList.toggle("btn-danger-outline", enabled);
}

$("btn-reminder").addEventListener("click", async () => {
  if (localStorage.getItem(REMINDER_KEY)) {
    localStorage.removeItem(REMINDER_KEY);
    renderReminderControls();
    writeReminderMeta();
    showToast(t("settings.reminderOff"));
    return;
  }
  if (!("Notification" in window)) {
    showToast(t("settings.reminderDenied"));
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast(t("settings.reminderDenied"));
    return;
  }
  const time = $("reminder-time").value || "20:00";
  localStorage.setItem(REMINDER_KEY, time);
  renderReminderControls();
  writeReminderMeta();
  registerPeriodicReminder();
  showToast(t("settings.reminderSaved"));
});

async function registerPeriodicReminder() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      await reg.periodicSync.register("qada-reminder", { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch { /* غير مدعوم — يبقى التذكير داخل التطبيق فقط */ }
}

/* عاكس صغير للحالة في Cache Storage ليقرأه عامل الخدمة (لا يصل إلى localStorage) */
function writeReminderMeta() {
  if (!("caches" in window)) return;
  const today = state ? (state.log[todayKey()] || { p: 0, f: 0 }) : { p: 0, f: 0 };
  const meta = {
    reminder: localStorage.getItem(REMINDER_KEY) || "",
    date: todayKey(),
    todayCount: today.p + today.f,
    title: t("reminder.notifTitle"),
    body: t("reminder.notifBody"),
  };
  caches.open("qada-meta")
    .then((c) => c.put("meta.json", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } })))
    .catch(() => {});
}

/* تذكير داخل التطبيق عندما يكون مفتوحًا وقت التذكير */
function checkLocalReminder() {
  const time = localStorage.getItem(REMINDER_KEY);
  if (!time || !state) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (localStorage.getItem(REMINDER_SHOWN_KEY) === todayKey()) return;
  const [h, m] = time.split(":").map(Number);
  const now = new Date();
  if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return;
  const today = state.log[todayKey()];
  if (today && (today.p > 0 || today.f > 0)) return;
  localStorage.setItem(REMINDER_SHOWN_KEY, todayKey());
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(t("reminder.notifTitle"), {
      body: t("reminder.notifBody"),
      icon: "icons/icon-192.png",
      tag: "qada-reminder",
    }))
    .catch(() => {});
}
setInterval(checkLocalReminder, 10 * 60 * 1000);

/* ═══ النسخ الاحتياطي ═══ */

$("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `qada-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
  showToast(t("settings.exported"));
});

$("btn-import").addEventListener("click", () => $("import-file").click());

$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !parsed.totals || !parsed.done) {
      throw new Error("بنية غير صالحة");
    }
    state = sanitize(parsed);
    persist();
    buildPrayerCards();
    showView("main");
    showToast(t("settings.imported"));
  } catch {
    showToast(t("settings.importInvalid"));
  }
});

/* تنبيه لطيف عند مرور مدة طويلة بلا نسخة احتياطية */
function maybeNagBackup() {
  if (!state) return;
  const snooze = Number(localStorage.getItem(BACKUP_SNOOZE_KEY) || 0);
  if (Date.now() < snooze) return;
  const lastExport = Number(localStorage.getItem(LAST_EXPORT_KEY) || 0);
  const doneAll = totalDoneAll(state) + state.fasting.done;
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const due = (!lastExport && doneAll >= 50)
    || (lastExport > 0 && Date.now() - lastExport > THIRTY_DAYS && state.updatedAt > lastExport);
  if (!due) return;
  localStorage.setItem(BACKUP_SNOOZE_KEY, String(Date.now() + 14 * 24 * 60 * 60 * 1000));
  showToast(t("backup.nag"), () => $("btn-export").click(), t("backup.now"));
}

/* ═══ إعادة التعيين ═══ */

$("btn-reset").addEventListener("click", () => {
  const word = $("reset-confirm").value.trim();
  if (word !== t("settings.resetWord") && word !== "نعم" && word.toUpperCase() !== "YES") {
    showToast(t("settings.resetType"));
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  state = null;
  $("reset-confirm").value = "";
  $("setup-form").reset();
  updateSetupPreview();
  showView("setup");
  showToast(t("settings.resetDone"));
});

/* ═══════════════════ التنبيهات ═══════════════════ */

const toastEl = $("toast");
let toastTimer = null;
let toastActionFn = null;

function showToast(text, actionFn = null, actionLabel = null) {
  clearTimeout(toastTimer);
  toastActionFn = actionFn;
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !actionFn;
  if (actionFn) $("toast-undo").textContent = actionLabel || t("toast.undo");
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; toastActionFn = null; }, actionFn ? 6000 : 2500);
}

$("toast-undo").addEventListener("click", () => {
  if (toastActionFn) toastActionFn();
  toastActionFn = null;
  toastEl.hidden = true;
});

/* ═══════════════════ المشاركة والتثبيت ═══════════════════ */

$("btn-share").addEventListener("click", async () => {
  const url = location.origin + location.pathname;
  const data = { title: t("share.title"), text: t("share.text"), url };
  if (navigator.share) {
    try { await navigator.share(data); } catch { /* أغلق المستخدم نافذة المشاركة */ }
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(url);
    showToast(t("share.copied"));
  }
});

let deferredInstallPrompt = null;

// إظهار/إخفاء الشريط مع حجز مساحة له أسفل التطبيق
function setInstallHint(visible) {
  $("install-hint").hidden = !visible;
  document.body.classList.toggle("has-install-hint", visible);
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (isAppInstalled()) return;
  $("btn-install-icon").hidden = false; // أيقونة دائمة في الشريط العلوي
  if (localStorage.getItem("qada-install-hint-dismissed")) return;
  setInstallHint(false); // بطاقة التثبيت البارزة تغني عن شريط التعليمات
  $("install-card").hidden = false;
});

function requestInstall() {
  // التأكد أولًا أن التطبيق ليس مثبتًا بالفعل
  if (isAppInstalled()) {
    $("btn-install-icon").hidden = true;
    $("install-card").hidden = true;
    showToast(t("install.already"));
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    $("install-card").hidden = true;
  } else {
    showToast(t("install.hintOther"));
  }
}

$("btn-install").addEventListener("click", requestInstall);
$("btn-install-icon").addEventListener("click", requestInstall);

$("install-card-close").addEventListener("click", () => {
  $("install-card").hidden = true;
  localStorage.setItem("qada-install-hint-dismissed", "1");
});

window.addEventListener("appinstalled", () => {
  $("install-card").hidden = true;
  $("btn-install-icon").hidden = true;
  setInstallHint(false);
  localStorage.setItem("qada-install-hint-dismissed", "1");
  showToast(t("install.done"));
});

/* ═══════════════════ المساعدة والجولة التعريفية ═══════════════════ */

$("btn-help").addEventListener("click", () => showView("help"));
$("btn-replay-tour").addEventListener("click", () => {
  showView("main");
  startTour();
});

const TOUR_STEPS = [
  { el: () => $("btn-day-done"), key: "tour.dayDone" },
  { el: () => document.querySelector("#prayer-list .prayer-actions"), key: "tour.counters" },
  { el: () => document.querySelector(".tabs"), key: "tour.tabs" },
  { el: () => $("btn-share"), key: "tour.share" },
  { el: () => $("btn-settings"), key: "tour.settings" },
];

let tourIndex = -1;

function startTour() {
  if (!state) return;
  localStorage.setItem("qada-tour-done", "1");
  showTab("prayers");
  tourIndex = -1;
  $("tour").hidden = false;
  nextTourStep();
}

function maybeStartTour() {
  if (localStorage.getItem("qada-tour-done")) return;
  setTimeout(startTour, 500);
}

function nextTourStep() {
  tourIndex++;
  if (tourIndex >= TOUR_STEPS.length) {
    $("tour").hidden = true;
    return;
  }
  const step = TOUR_STEPS[tourIndex];
  const el = step.el();
  if (!el) { nextTourStep(); return; }
  el.scrollIntoView({ block: "center" });
  positionTourStep(el, step);
}

function positionTourStep(el, step) {
  const r = el.getBoundingClientRect();
  const hl = $("tour-highlight");
  hl.style.top = `${r.top - 6}px`;
  hl.style.left = `${r.left - 6}px`;
  hl.style.width = `${r.width + 12}px`;
  hl.style.height = `${r.height + 12}px`;
  $("tour-title").textContent = t(step.key + ".t");
  $("tour-text").textContent = t(step.key + ".b");
  $("tour-next").textContent = t(tourIndex === TOUR_STEPS.length - 1 ? "tour.finish" : "tour.next");
  $("tour-dots").innerHTML = TOUR_STEPS
    .map((_, i) => `<span class="dot${i === tourIndex ? " active" : ""}"></span>`)
    .join("");
  const bubble = $("tour-bubble");
  const bubbleH = bubble.offsetHeight || 160;
  let top = r.bottom + 14;
  if (top + bubbleH > window.innerHeight - 10) top = Math.max(10, r.top - bubbleH - 14);
  bubble.style.top = `${top}px`;
}

$("tour-next").addEventListener("click", nextTourStep);
$("tour-skip").addEventListener("click", () => { $("tour").hidden = true; });

window.addEventListener("resize", () => {
  if (!$("tour").hidden && tourIndex >= 0 && tourIndex < TOUR_STEPS.length) {
    const step = TOUR_STEPS[tourIndex];
    const el = step.el();
    if (el) positionTourStep(el, step);
  }
});

/* ═══════════════════ تلميح التثبيت ═══════════════════ */

function maybeShowInstallHint() {
  const dismissed = localStorage.getItem("qada-install-hint-dismissed");
  if (dismissed || isAppInstalled()) return;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $("install-hint-text").textContent = t(isIOS ? "install.hintIOS" : "install.hintOther");
  setInstallHint(true);
}

$("install-hint-close").addEventListener("click", () => {
  setInstallHint(false);
  localStorage.setItem("qada-install-hint-dismissed", "1");
});

/* ═══════════════════ البدء ═══════════════════ */

// آية أو حديث يتبدل يوميًا
function setMotivation() {
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86400000);
  $("motivation-text").textContent = t(`motivation.${dayOfYear % MOTIVATION_COUNT}`);
}

state = loadState();
applyLang(null); // تطبيق اللغة المحفوظة على كل النصوص
applyTheme(localStorage.getItem(THEME_KEY) || "system");
if (state) {
  persist(); // تثبيت الترقية من إصدار أقدم فورًا
  buildPrayerCards();
  showView("main");
  maybeStartTour();
  setTimeout(maybeNagBackup, 2500);
  checkLocalReminder();
} else {
  showView("setup");
}
maybeShowInstallHint();

if ("serviceWorker" in navigator) {
  // إن لم يكن للصفحة متحكّم سابق فهذا أول تثبيت وليس تحديثًا — لا نظهر الإشعار
  const isUpdate = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("message", (e) => {
    if (isUpdate && e.data && e.data.type === "UPDATE_READY") {
      $("update-note").textContent = e.data.note || "";
      $("update-banner").hidden = false;
    }
  });

  $("btn-update").addEventListener("click", () => {
    if (state) persist();
    location.reload();
  });

  navigator.serviceWorker.register("sw.js")
    .then(() => { if (localStorage.getItem(REMINDER_KEY)) registerPeriodicReminder(); })
    .catch(() => { /* يعمل التطبيق بدونه، فقط بلا وضع عدم الاتصال */ });
}
