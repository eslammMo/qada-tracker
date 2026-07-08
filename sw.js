"use strict";

const CACHE_NAME = "qada-v9";
const META_CACHE = "qada-meta"; // يكتبه التطبيق ليقرأه عامل الخدمة (التذكير)

// عدّل هذين مع كل إصدار: اسم الذاكرة أعلاه + وصف قصير للتحديث هنا
const UPDATE_NOTE = "جديد: أوسمة الإنجاز 🏅، تذكير يومي، مظهر فاتح/داكن، اللغة الإنجليزية، وشارة الهدف على أيقونة التطبيق.";

const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/i18n.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== META_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => {
        // إبلاغ الصفحات المفتوحة بأن نسخة جديدة صارت جاهزة
        clients.forEach((c) => c.postMessage({ type: "UPDATE_READY", note: UPDATE_NOTE }));
      })
  );
});

// الملفات من الذاكرة أولًا؛ الشبكة احتياط فقط
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true, cacheName: CACHE_NAME }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

/* ═══ التذكير اليومي عبر Periodic Background Sync ═══ */

function swDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function checkReminder() {
  const cache = await caches.open(META_CACHE);
  const res = await cache.match("meta.json");
  if (!res) return;
  const meta = await res.json();
  if (!meta.reminder) return;
  const now = new Date();
  const today = swDateKey(now);
  const [h, m] = meta.reminder.split(":").map(Number);
  const due = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  if (!due) return;
  if (meta.date === today && meta.todayCount > 0) return; // سجّل شيئًا اليوم بالفعل
  if (meta.lastNotified === today) return; // ذُكِّر اليوم بالفعل
  await self.registration.showNotification(meta.title || "قضاء الصلوات 🕌", {
    body: meta.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "qada-reminder",
  });
  meta.lastNotified = today;
  await cache.put("meta.json", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "qada-reminder") event.waitUntil(checkReminder());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("./");
    })
  );
});
