// 가족금융일정표 서비스 워커: 푸시 알림 표시 + 오프라인 실행
var CACHE = 'fs-shell-v1';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-180.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 네트워크 우선, 실패하면 캐시 (앱 파일만)
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); })
  );
});

// iOS는 푸시를 받으면 반드시 알림을 띄워야 하므로 항상 showNotification 호출
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data.json(); } catch (err) { d = { title: '가족금융일정표', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '가족금융일정표', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: d
  }));
});

// 알림을 누르면 앱을 열고 해당 대출의 납입 화면(계좌 복사)을 띄움
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var d = e.notification.data || {};
  var url = new URL('./', self.registration.scope);
  if (d.loanId) url.searchParams.set('loan', d.loanId);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
          if (d.loanId) c.postMessage({ type: 'open-loan', loanId: d.loanId });
          return c.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })
  );
});
