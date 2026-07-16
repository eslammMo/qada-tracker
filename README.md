<div dir="rtl">

# 🕌 قضاء الصلوات — Qada Prayer Tracker

تطبيق ويب خفيف يعمل بدون إنترنت لمتابعة قضاء الصلوات والصيام الفائت.
أدخل المدة التي فاتتك، وتابع تقدّمك صلاةً بصلاة حتى تُتمّ ما عليك.

</div>

**Offline-first PWA** for tracking make-up (qada) prayers and fasting — Arabic + English, installable on any phone, no frameworks, no build step, no dependencies.

---

## ✨ Features | المميزات

| | Feature |
|---|---|
| 🧮 | **Automatic calculation** — enter missed years/months/days (Hijri or Gregorian, with leap-year guidance) and the owed count per prayer is computed |
| 🔢 | **5 prayer counters** — الفجر، الظهر، العصر، المغرب، العشاء — big **+١**, undo **−١**, and bulk **+٥/custom** with undo toast |
| ✓ | **Full-day button** — one tap logs a whole made-up day (one prayer of each type) |
| 🌙 | **Fasting qada** — a separate tab tracks missed fasting days the same way |
| 📊 | **Statistics** — daily goal with progress, 🔥 day streak, estimated finish date (Hijri + Gregorian), and a 14-day activity chart |
| 🏅 | **Badges** — 11 milestones (100/500/1000/5000 prayers, 25–100% completion, 7/30-day streaks, fasting complete) with celebrations |
| ⏰ | **Daily reminder** — optional notification at a time you choose (Android, installed app) |
| 🛡️ | **Data can't be lost** — every change is validated and clamped through one code path; editing totals or recalculating **never erases progress**; JSON backup export/import + periodic backup reminders |
| 🌍 | **Arabic & English** — full RTL/LTR mirroring, Arabic-Indic or Western digits |
| 🎨 | **Light / dark / auto theme** + app-icon badge showing today's remaining goal |
| 📲 | **Installable & offline** — one-tap install button; works with no internet at all after first load |
| 🧭 | **Built-in help** — first-launch guided tour + a ؟ help page explaining every feature |
| 📈 | **Anonymous analytics** — privacy-first visit counting (no cookies, no personal data — see [ANALYTICS.md](ANALYTICS.md)) |

## 🚀 Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open <http://localhost:8080> — the service worker needs `localhost` or HTTPS.

## 📲 Install on your phone

The app is served over HTTPS (GitHub Pages). On first visit an **install card** appears:

- **Android (Chrome):** tap «التثبيت الآن» — or menu **⋮** → **Install app**
- **iPhone (Safari):** **Share** → **Add to Home Screen**

After the first load it works fully offline. All prayer data stays on the device — nothing is uploaded anywhere.

> 💡 Export a backup from settings occasionally; clearing browser/site data erases progress.

## 🗂️ Project structure

```
qada-tracker/
├── index.html      # all screens: setup / counters / stats / settings / help
├── css/style.css   # RTL+LTR, mobile-first, light + dark
├── js/app.js       # state, counters, stats, badges, reminders — one update() path with clamping
├── js/i18n.js      # all UI strings (ar / en)
├── sw.js           # cache-first service worker + update banner + reminder sync
├── manifest.json   # PWA manifest
├── ANALYTICS.md    # how the anonymous visit counter works
└── icons/          # SVG + 192/512 PNG
```

## 🔧 Tech

Plain HTML + CSS + vanilla JavaScript. State is a single versioned object in `localStorage` with migrations. See [CLAUDE.md](CLAUDE.md) for architecture and invariants.

---

<div dir="rtl">

**تقبّل الله منا ومنكم صالح الأعمال** 🤲

</div>
