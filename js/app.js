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
    version: 1,
    calendar: s.calendar === "gregorian" ? "gregorian" : "hijri",
    totals: emptyCounts(),
    done: emptyCounts(),
    updatedAt: Date.now(),
  };
  for (const { id } of PRAYERS) {
    const total = toSafeInt(s.totals?.[id]);
    const done = toSafeInt(s.done?.[id]);
    clean.totals[id] = total;
    clean.done[id] = Math.min(done, total); // لا يتجاوز المنجز المطلوب أبدًا
  }
  return clean;
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
    els.bulk.addEventListener("click", () => openBulkDialog(id, name));
    cardEls[id] = els;
    list.appendChild(card);
  }
}

function addDone(id, delta) {
  const before = state.done[id];
  update((s) => { s.done[id] += delta; });
  const applied = state.done[id] - before;
  if (applied !== 0) {
    cardEls[id].count.classList.remove("bump");
    void cardEls[id].count.offsetWidth; // إعادة تشغيل الحركة
    cardEls[id].count.classList.add("bump");
    if (navigator.vibrate) navigator.vibrate(delta > 0 ? 15 : [10, 40, 10]);
  }
  return applied;
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
}

/* ═══════════════════ الإضافة المخصصة ═══════════════════ */

const bulkDialog = $("bulk-dialog");
let bulkPrayerId = null;

function openBulkDialog(id, name) {
  bulkPrayerId = id;
  $("bulk-title").textContent = `إضافة عدد — ${name}`;
  const remaining = state.totals[id] - state.done[id];
  const input = $("bulk-count");
  input.max = String(remaining);
  input.value = String(Math.min(5, remaining));
  bulkDialog.showModal();
  input.select();
}

bulkDialog.addEventListener("close", () => {
  if (bulkDialog.returnValue !== "ok" || !bulkPrayerId) return;
  const id = bulkPrayerId;
  bulkPrayerId = null;
  const requested = toSafeInt($("bulk-count").value);
  if (requested <= 0) return;
  const applied = addDone(id, requested);
  if (applied <= 0) return;
  const msg = applied < requested
    ? `أُضيفت ${num(applied)} فقط (اكتمل العدد المطلوب)`
    : `أُضيفت ${num(applied)} صلاة`;
  showToast(msg, () => addDone(id, -applied));
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
}

$("totals-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const newTotals = {};
  let clamped = false;
  for (const { id } of PRAYERS) {
    newTotals[id] = toSafeInt($(`total-${id}`).value);
    if (newTotals[id] < state.done[id]) clamped = true;
  }
  if (clamped && !confirm("بعض الأعداد الجديدة أقل مما أنجزته بالفعل، وسيُعتبر ذلك الفرض مكتملًا. متابعة؟")) {
    return;
  }
  update((s) => { s.totals = newTotals; });
  showToast("تم حفظ التعديلات");
  showView("main");
});

$("btn-recalc").addEventListener("click", () => showView("setup"));

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

state = loadState();
if (state) {
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
