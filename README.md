<div dir="rtl">

# 🕌 قضاء الصلوات — Qada Prayer Tracker

تطبيق ويب خفيف يعمل بدون إنترنت لمتابعة قضاء الصلوات الفائتة.
أدخل المدة التي فاتتك فيها الصلاة، وتابع تقدّمك صلاةً بصلاة.

</div>

**Offline-first PWA** for tracking make-up (qada) prayers — Arabic RTL interface, installable on any phone, no frameworks, no build step, **~45 KB total**.

---

## ✨ Features | المميزات

| | Feature |
|---|---|
| 🧮 | **Automatic calculation** — enter missed years / months / days (Hijri 354-day or Gregorian 365-day year) and the app computes the owed count for each prayer |
| 🔢 | **5 counters** — الفجر، الظهر، العصر، المغرب، العشاء — each with a large **+١** button, a small **−١** undo, and **+٥ / custom** bulk add with an undo toast |
| 📊 | **Progress everywhere** — overall completion ring plus a progress bar per prayer; finished prayers lock with a «✓ اكتمل القضاء» badge |
| 🛡️ | **Data can't be lost** — every change is validated and clamped (`0 ≤ done ≤ total`) through a single update path, saved instantly on every tap, and again when the app closes. Editing totals or recalculating later **never erases your progress** |
| 💾 | **Backup** — export / import your data as a JSON file from settings; full reset requires typing «نعم» |
| 📱 | **Installable & offline** — add to home screen once, then it works with no internet at all (service worker, cache-first) |
| 🌙 | **Light & dark themes** — follows your phone's system theme automatically |

## 📱 Screens

1. **Setup** — سنوات / شهور / أيام inputs with a live preview: *«عليك قضاء ٤٢٤ صلاة لكل فرض»*
2. **Main** — overall ring (٣٣٪، أنجزت ٣٣٧، المتبقي ٦٦٣) + five color-coded prayer cards
3. **Settings** — edit totals, recalculate, backup / restore, full reset

## 🚀 Run locally

Any static file server works — from inside this folder:

```bash
python -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>. *(The service worker needs `localhost` or HTTPS.)*

## 📲 Install on your phone

The app must be served over **HTTPS** — GitHub Pages does this for free (see below). Then:

- **Android (Chrome):** open the URL → menu **⋮** → **Install app** / **Add to Home Screen**
- **iPhone (Safari):** open the URL → **Share** → **Add to Home Screen**

After the first load it works fully offline. Your data lives on your device only — nothing is sent anywhere.

> 💡 **Tip:** export a backup from settings once in a while — clearing browser/site data erases progress.

## 🗂️ Project structure

```
qada-tracker/
├── index.html      # single page: setup / counters / settings screens
├── css/style.css   # RTL, mobile-first, light + dark
├── js/app.js       # state, calculation, counters — one update() path with clamping
├── sw.js           # cache-first service worker (offline support)
├── manifest.json   # PWA manifest (Arabic, RTL, standalone)
└── icons/          # SVG + 192px / 512px PNG icons
```

## 🔧 Tech

Plain HTML + CSS + vanilla JavaScript. No frameworks, no dependencies, no build step. State is a single versioned object in `localStorage`.

---

<div dir="rtl">

**تقبّل الله منا ومنكم صالح الأعمال** 🤲

</div>
