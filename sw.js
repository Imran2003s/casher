// sw.js - Service Worker لتخزين ملفات التطبيق للعمل بدون إنترنت

// قائمة الملفات التي سيتم تخزينها مؤقتًا
const CACHE_NAME = 'school-pos-v1';
const urlsToCache = [
  '/',               // صفحة index.html الرئيسية
  '/index.html',
  '/app.js',
  '/style.css',      // إذا كان لديك ملف CSS منفصل
  // أضف أي ملفات أخرى ضرورية هنا (صور، خطوط، إلخ)
];

// حدث التثبيت: يتم تخزين الملفات مؤقتًا عند تثبيت الـ Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('تم فتح الكاش وتخزين الملفات');
        return cache.addAll(urlsToCache);
      })
  );
});

// حدث الجلب: يتم اعتراض الطلبات وتقديم النسخة المخزنة مؤقتًا عند عدم وجود إنترنت
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // إذا وجدت النسخة في الكاش، قدمها
        if (response) {
          return response;
        }
        // وإلا، حاول جلبها من الشبكة
        return fetch(event.request);
      })
  );
});

// حدث التنشيط: يتم تنظيف الكاش القديم
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});