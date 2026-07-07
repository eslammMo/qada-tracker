"use strict";

/* ═══════════════════ الثوابت ═══════════════════ */

const STORAGE_KEY = "qada-state-v1";
const HIJRI_YEAR_DAYS = 354;
const GREGORIAN_YEAR_DAYS = 365;
const MONTH_DAYS = 30;

const PRAYERS = [
  { id: "fajr",    name: "الفجر"   },
  { id: "dhuhr",   name: "الظهر"   },
  { id: "asr",     name: "العصر"   },
  { id: "maghrib", name: "المغرب"  },
  { id: "isha",    name: "العشاء"  },
];

const fmt = new Intl.NumberFormat("ar-EG");
const num = (n) => fmt.format(n);

const LOG_RETENTION_DAYS = 90;

const gregDateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" });
const hijriDateFmt = new Intl.DateTimeFormat("ar-EG-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayKey = () => dateKey(new Date());

function daysWord(n) {
  return n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${num(n)} أيام` : `${num(n)} يومًا`;
}

const MOTIVATION = [
  "«أَحَبُّ الأعمالِ إلى اللهِ أدومُها وإن قَلَّ» — متفق عليه",
  "«إنَّ أولَ ما يُحاسَبُ به العبدُ يومَ القيامةِ من عملِه صلاتُه» — رواه أبو داود",
  "﴿إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا﴾",
  "﴿وَسَارِعُوا إِلَىٰ مَغْفِرَةٍ مِنْ رَبِّكُمْ وَجَنَّةٍ عَرْضُهَا السَّمَاوَاتُ وَالْأَرْضُ﴾",
  "﴿فَاسْتَبِقُوا الْخَيْرَاتِ﴾",
  "«من نَسِيَ صلاةً فليصلِّها إذا ذكرها» — متفق عليه",
  "﴿وَأَقِمِ الصَّلَاةَ لِذِكْرِي﴾",
  "﴿إِنَّ الْحَسَنَاتِ يُذْهِبْنَ السَّيِّئَاتِ﴾",
  "«واعلموا أنَّ خيرَ أعمالِكم الصلاةَ» — رواه ابن ماجه",
  "قليلٌ دائمٌ خيرٌ من كثيرٍ منقطع — داوم ولو على صلاة واحدة يوميًا",
];

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

/* كل تعديل يمر من هنا: تحقّق ← تقييد ← حفظ ← عرض */
function update(mutator) {
  mutator(state);
  state = sanitize(state);
  persist();
  renderMain();
}

function sanitize(s) {
  const clean = {
    version: 2,
    calendar: s.calendar === "gregorian" ? "gregorian" : "hijri",
    totals: emptyCounts(),
    done: emptyCounts(),
    fasting: { total: toSafeInt(s.fasting?.total), done: 0 },
    goal: Math.min(toSafeInt(s.goal), 1000),
    log: {},
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
}

// حفظ إضافي عند مغادرة الصفحة (احتياط)
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state) persist();
});

/* ═══════════════════ العناصر ═══════════════════ */

const $ = (id) => document.getElementById(id);

const views = {
  setup: $("view-setup"),
  main: $("view-main"),
  settings: $("view-settings"),
};

let currentView = "setup";

function showView(name) {
  currentView = name;
  for (const key of Object.keys(views)) views[key].hidden = key !== name;
  $("btn-settings").hidden = name !== "main";
  $("btn-back").hidden = name === "main" || (name === "setup" && !state);
  if (name === "main") renderMain();
  if (name === "settings") renderSettingsInputs();
}

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
  const daysWord =
    maxExtraDays === 1 ? "يوم واحد" :
    maxExtraDays === 2 ? "يومين" :
    maxExtraDays <= 10 ? `${num(maxExtraDays)} أيام` :
    `${num(maxExtraDays)} يومًا`;
  el.hidden = false;
  el.textContent = maxExtraDays > 0
    ? `⚠️ ملاحظة: بعض السنوات الميلادية كبيسة (٣٦٦ يومًا). لمدة ${num(years)} سنة قد تحتاج إضافة حتى ${daysWord} في خانة الأيام — مع ملحوظة أن هذا أقصى عدد أيام ممكن أن يكون إضافيًا.`
    : "⚠️ ملاحظة: بعض السنوات الميلادية كبيسة (٣٦٦ يومًا)، فقد تحتاج إضافة يوم عن كل سنة كبيسة مرّت خلال المدة.";
}

function updateSetupPreview() {
  updateLeapNote();
  const { totalDays } = readSetupInputs();
  const el = $("setup-preview");
  if (totalDays > 0) {
    el.hidden = false;
    el.textContent = `عليك قضاء ${num(totalDays)} صلاة لكل فرض (${num(totalDays * 5)} صلاة إجمالًا)`;
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
    showToast("أدخل مدة أكبر من صفر");
    return;
  }
  const previousDone = state ? state.done : emptyCounts();
  state = sanitize({
    calendar,
    totals: { fajr: totalDays, dhuhr: totalDays, asr: totalDays, maghrib: totalDays, isha: totalDays },
    done: previousDone, // إعادة الحساب لا تمسح ما أنجزته
  });
  persist();
  buildPrayerCards();
  showView("main");
});

/* ═══════════════════ الشاشة الرئيسية ═══════════════════ */

const cardEls = {}; // { fajr: {count, fill, inc, dec, bulk, actions, badge}, ... }

function buildPrayerCards() {
  const list = $("prayer-list");
  list.innerHTML = "";
  for (const { id, name } of PRAYERS) {
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
        <button class="btn-inc" aria-label="إضافة صلاة ${name}">+١</button>
        <button class="btn-small btn-bulk" aria-label="إضافة عدد لصلاة ${name}">+٥</button>
        <button class="btn-small btn-dec" aria-label="تراجع عن صلاة ${name}">−١</button>
      </div>
      <div class="prayer-complete-badge" hidden>✓ اكتمل القضاء — تقبّل الله</div>
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
  $("overall-percent").textContent = num(Math.floor(percent)) + "٪";
  $("overall-done").textContent = num(doneAll);
  $("overall-remaining").textContent = num(totalAll - doneAll);
  const CIRC = 263.9;
  $("ring-progress").style.strokeDashoffset = String(CIRC - (CIRC * percent) / 100);
  $("btn-day-done").disabled = doneAll >= totalAll;
  renderFasting();
  if (!views.main.hidden && !$("tab-stats").hidden) renderStats();
}

/* ═══════════════════ التبويبات ═══════════════════ */

const TAB_NAMES = ["prayers", "fasting", "stats"];

function showTab(name) {
  for (const t of TAB_NAMES) {
    $("tab-" + t).hidden = t !== name;
    $("tab-btn-" + t).classList.toggle("active", t === name);
  }
  if (name === "stats") renderStats();
}

for (const t of TAB_NAMES) {
  $("tab-btn-" + t).addEventListener("click", () => showTab(t));
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
    ? "أُضيف يوم كامل — تقبّل الله"
    : `أُضيفت ${num(incremented.length)} صلوات (الباقي مكتمل)`;
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
$("fasting-bulk").addEventListener("click", () => openBulkDialog("fasting", null, "أيام الصيام"));

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
  if (remaining === 0) return "اكتمل قضاء الصلوات — تقبّل الله 🎉";
  let rate = state.goal;
  let basis = "بهدفك اليومي";
  if (rate <= 0) {
    let sum = 0;
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      const e = state.log[dateKey(d)];
      if (e) sum += e.p;
      d.setDate(d.getDate() - 1);
    }
    rate = sum / 7;
    basis = "بمعدلك خلال آخر ٧ أيام";
  }
  if (rate <= 0) return "حدد هدفًا يوميًا من الإعدادات، أو ابدأ التسجيل ليظهر التقدير هنا.";
  const days = Math.ceil(remaining / rate);
  const end = new Date();
  end.setDate(end.getDate() + days);
  return `${basis}، ستُنهي القضاء بعد نحو ${daysWord(days)} إن شاء الله — ${hijriDateFmt.format(end)} (${gregDateFmt.format(end)})`;
}

function renderStats() {
  if (!state) return;
  const today = state.log[todayKey()] || { p: 0, f: 0 };
  $("today-value").textContent = num(today.p);
  $("streak-value").textContent = num(computeStreak(state.log));

  const goal = state.goal;
  if (goal > 0) {
    const met = today.p >= goal;
    $("goal-status").textContent = met
      ? `ما شاء الله — أنجزت هدف اليوم (${num(today.p)} من ${num(goal)})`
      : `أنجزت ${num(today.p)} من ${num(goal)} — واصل!`;
    $("goal-fill").style.width = `${Math.min(100, (today.p / goal) * 100)}%`;
    $("goal-card").classList.toggle("goal-met", met);
  } else {
    $("goal-status").textContent = "لم تحدد هدفًا يوميًا — يمكنك تحديده من الإعدادات.";
    $("goal-fill").style.width = "0%";
    $("goal-card").classList.remove("goal-met");
  }

  $("estimate-text").textContent = estimateText();
  buildChart();
}

/* مخطط آخر ١٤ يومًا — SVG بلا مكتبات، الأحدث على اليمين */
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
    wrap.innerHTML = `<p class="hint-text chart-empty">لا يوجد نشاط بعد — ابدأ اليوم وسيظهر تقدمك هنا.</p>`;
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
      + `<text x="${left + plotW}" y="${gy - 4}" text-anchor="end" class="chart-goal-label">الهدف ${num(goal)}</text>`;
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
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="chart-day">${isToday ? "اليوم" : num(dt.getDate())}</text>`;
    }
  });
  svg += `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" class="chart-baseline"/>`;
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="الصلوات المقضية يوميًا خلال آخر ١٤ يومًا">${svg}</svg>`;
}

/* ═══════════════════ الإضافة المخصصة ═══════════════════ */

const bulkDialog = $("bulk-dialog");
let bulkTarget = null; // { kind: "prayer", id } أو { kind: "fasting" }

function openBulkDialog(kind, id, name) {
  bulkTarget = { kind, id };
  $("bulk-title").textContent = `إضافة عدد — ${name}`;
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
  const unit = kind === "fasting" ? "يوم" : "صلاة";
  const msg = applied < requested
    ? `أُضيفت ${num(applied)} فقط (اكتمل العدد المطلوب)`
    : `أُضيفت ${num(applied)} ${unit}`;
  showToast(msg, () => apply(-applied));
});

/* ═══════════════════ الإعدادات ═══════════════════ */

$("btn-settings").addEventListener("click", () => showView("settings"));
$("btn-back").addEventListener("click", () => showView("main"));

function renderSettingsInputs() {
  const grid = $("totals-inputs");
  grid.innerHTML = "";
  for (const { id, name } of PRAYERS) {
    const label = document.createElement("label");
    label.className = "field";
    label.style.setProperty("--p-color", `var(--c-${id})`);
    label.innerHTML = `<span>${name} (أنجزت ${num(state.done[id])})</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.id = `total-${id}`;
    input.value = String(state.totals[id]);
    label.appendChild(input);
    grid.appendChild(label);
  }
  // صف الصيام
  const fLabel = document.createElement("label");
  fLabel.className = "field";
  fLabel.style.setProperty("--p-color", "var(--c-fasting)");
  fLabel.innerHTML = `<span>أيام الصيام (أنجزت ${num(state.fasting.done)})</span>`;
  const fInput = document.createElement("input");
  fInput.type = "number";
  fInput.inputMode = "numeric";
  fInput.min = "0";
  fInput.id = "total-fasting";
  fInput.value = String(state.fasting.total);
  fLabel.appendChild(fInput);
  grid.appendChild(fLabel);

  $("goal-input").value = String(state.goal);
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
  if (clamped && !confirm("بعض الأعداد الجديدة أقل مما أنجزته بالفعل، وسيُعتبر ذلك الفرض مكتملًا. متابعة؟")) {
    return;
  }
  update((s) => {
    s.totals = newTotals;
    s.fasting.total = newFastingTotal;
  });
  showToast("تم حفظ التعديلات");
  showView("main");
});

$("btn-recalc").addEventListener("click", () => showView("setup"));

$("goal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  update((s) => { s.goal = Math.min(toSafeInt($("goal-input").value), 1000); });
  showToast("تم حفظ الهدف اليومي");
  showView("main");
  showTab("stats");
});

/* ═══ النسخ الاحتياطي ═══ */

$("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `qada-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("تم تصدير النسخة الاحتياطية");
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
    showToast("تم استيراد البيانات بنجاح");
  } catch {
    showToast("الملف غير صالح — لم يتغير شيء");
  }
});

/* ═══ إعادة التعيين ═══ */

$("btn-reset").addEventListener("click", () => {
  if ($("reset-confirm").value.trim() !== "نعم") {
    showToast("اكتب «نعم» في الخانة للتأكيد");
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  state = null;
  $("reset-confirm").value = "";
  $("setup-form").reset();
  updateSetupPreview();
  showView("setup");
  showToast("تمت إعادة التعيين");
});

/* ═══════════════════ التنبيهات ═══════════════════ */

const toastEl = $("toast");
let toastTimer = null;
let toastUndoFn = null;

function showToast(text, undoFn = null) {
  clearTimeout(toastTimer);
  toastUndoFn = undoFn;
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !undoFn;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; toastUndoFn = null; }, undoFn ? 6000 : 2500);
}

$("toast-undo").addEventListener("click", () => {
  if (toastUndoFn) toastUndoFn();
  toastUndoFn = null;
  toastEl.hidden = true;
});

/* ═══════════════════ تلميح التثبيت ═══════════════════ */

function maybeShowInstallHint() {
  const dismissed = localStorage.getItem("qada-install-hint-dismissed");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (dismissed || standalone) return;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $("install-hint-text").textContent = isIOS
    ? "للتثبيت: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»"
    : "للتثبيت: افتح قائمة المتصفح ⋮ ثم «إضافة إلى الشاشة الرئيسية»";
  $("install-hint").hidden = false;
}

$("install-hint-close").addEventListener("click", () => {
  $("install-hint").hidden = true;
  localStorage.setItem("qada-install-hint-dismissed", "1");
});

/* ═══════════════════ البدء ═══════════════════ */

// آية أو حديث يتبدل يوميًا
(function setMotivation() {
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86400000);
  $("motivation-text").textContent = MOTIVATION[dayOfYear % MOTIVATION.length];
})();

state = loadState();
if (state) {
  persist(); // تثبيت الترقية من إصدار أقدم فورًا
  buildPrayerCards();
  showView("main");
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

  navigator.serviceWorker.register("sw.js").catch(() => { /* يعمل التطبيق بدونه، فقط بلا وضع عدم الاتصال */ });
}
