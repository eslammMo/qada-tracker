# 📊 Visitor Analytics with GoatCounter — How It Works

This document explains how [GoatCounter](https://www.goatcounter.com/) would give qada-tracker visitor statistics, how the data flows, and how it is stored over time.

---

## 1. What is GoatCounter?

[GoatCounter](https://www.goatcounter.com/) is a free, [open-source](https://github.com/arp242/goatcounter) visit counter built for personal sites and hobby projects. It was chosen for this app because:

- **No cookies, no personal data** → no annoying consent banner, and it doesn't break the app's promise that *"your data stays on your device"*. ([privacy details](https://www.goatcounter.com/help/privacy))
- **Free** for non-commercial use (soft limit ~100,000 pageviews/month — far more than needed).
- **Nearly zero weight** — the app sends its own tiny ping; no external script is loaded.
- **Ready-made dashboard** — nothing to build or host for viewing the numbers.

## 2. Who does what

| Who | Responsibility |
|---|---|
| **The app** (~10 lines of code) | Sends one anonymous ping each time someone opens it |
| **goatcounter.com** | Receives the pings, stores the history, renders the dashboard |
| **You** | Create the free account once, then open your dashboard whenever curious |

## 3. How a single visit is counted

```
Visitor's phone                     GoatCounter server                Your dashboard
───────────────                     ──────────────────                ────────────────────────
Opens the app                       Receives the ping and             qada-tracker.goatcounter.com
   │                                stores one aggregated row:        │
   └─► app sends one GET ping:      date, time, page, country,        └─► charts update:
       "/count?p=/app"              browser, screen size                  Today: 14 visits
       (path, referrer,                                                   This week: 90
       screen, user-agent)          The IP address is hashed             This month: 340
                                    with a daily-rotating salt
       Nothing is written to        and then DISCARDED.
       the visitor's device:        The hash itself is deleted
       no cookie, no storage,       at the end of every day.
       no fingerprint.
```

The ping is a plain HTTPS GET request. If the user is **offline** (this is an offline-first PWA), the ping silently fails and that open is simply not counted.

## 4. What "unique visitors" means here

To avoid counting the same person 5 times in one day, GoatCounter keeps a temporary anonymous hash (IP + browser + rotating secret) — and **deletes it at the end of each day**. Consequences:

- ✅ You get accurate **visits per day** and **daily unique visitors**.
- ❌ You can never get "lifetime distinct users" — the same person visiting Monday and Tuesday counts as 1 unique on each day. Recognizing them across days is deliberately impossible; that's the privacy feature. (No consent-free tool can do lifetime users.)

## 5. How data is stored over time

- Every ping becomes a permanent **aggregated record on GoatCounter's servers** — a growing ledger, one row per visit.
- **Nothing expires.** In 2028 you can still open the dashboard and see "July 2026: 412 visits". Charts can be viewed per hour, day, week, or month, back to the very first ping.
- Data is kept **as long as your account is active**. You can:
  - **Export everything as CSV** anytime (your own permanent copy),
  - **Delete** the data or account anytime,
  - Or **self-host** the open-source software later and keep full control.

## 6. What the dashboard shows

At `https://YOUR-CODE.goatcounter.com` you'll see:

- Visits and unique visitors over time (hour/day/week/month)
- **Pages** — we would send distinct paths to answer useful questions:
  - `/web` → opened in a browser
  - `/app` → opened as the installed PWA (real "users"!)
  - `/install` → fired once when someone installs the app
- Countries, browsers, operating systems, screen sizes
- Referrers (where visitors came from — e.g. WhatsApp, Facebook)

## 7. Limitations (honest list)

- **Offline opens are invisible** — pings need internet. True for every analytics tool.
- **Some ad-blockers** block known analytics domains, so real numbers may be slightly higher than reported.
- **Per-day uniqueness only** — see section 4.

## 8. Setup steps (when you're ready)

1. Go to <https://www.goatcounter.com/> → **Sign up** (free).
2. Choose a code, e.g. `qada-tracker` → your dashboard is instantly live at `https://qada-tracker.goatcounter.com`.
3. Tell Claude the code → the ~10-line beacon gets added to `js/app.js` (with `/web` / `/app` / `/install` paths), service worker version bumped, and pushed.
4. Open your dashboard anytime to watch the numbers.

---

## ملخص بالعربية 🇪🇬

**GoatCounter** عدّاد زيارات مجاني ومفتوح المصدر، مناسب لتطبيقنا لأنه لا يستخدم ملفات تعريف (كوكيز) ولا يجمع بيانات شخصية — فلا يتعارض مع وعد التطبيق بأن بيانات المستخدم تبقى على جهازه.

**طريقة العمل:** عند كل فتح للتطبيق تُرسَل إشارة صغيرة مجهولة إلى خوادم goatcounter.com تحتوي فقط على: الصفحة، الدولة، نوع المتصفح، مقاس الشاشة. عنوان IP يُشفَّر ثم يُحذف، ولا يُحفظ أي شيء على جهاز الزائر.

**تخزين البيانات مع الوقت:** كل زيارة تُسجَّل في سجل دائم على خوادمهم ولا تنتهي صلاحيتها — يمكنك بعد سنوات رؤية زيارات أي شهر سابق، وتصدير كل البيانات كملف CSV في أي وقت، أو حذفها. البيانات تبقى ما دام حسابك موجودًا.

**حدود مهمة:** «الزائر الفريد» يعني فريدًا خلال اليوم الواحد فقط (لا يمكن معرفة عدد المستخدمين الكلي مدى الحياة — هذه ميزة خصوصية)، وفتحات التطبيق بدون إنترنت لا تُحتسب.

**خطوات التفعيل:** أنشئ حسابًا مجانيًا في goatcounter.com واختر اسمًا مثل `qada-tracker`، ثم أخبر Claude بالاسم ليضيف كود الإرسال (~10 أسطر) وينشره — ولوحة الأرقام تكون جاهزة فورًا على `qada-tracker.goatcounter.com`.
