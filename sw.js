// Service Worker — يخزّن التطبيق للعمل بدون اتصال
const CACHE = 'scan3d-v3';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/viewer.js',
  './js/analysis.js',
  './js/exporters.js',
  './js/capture.js',
  './js/calc.js',
  './js/local.js',
  './js/materials.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/three/build/three.module.js',
  './vendor/three/build/three.core.js',
  './vendor/three/examples/jsm/controls/OrbitControls.js',
  './vendor/three/examples/jsm/loaders/STLLoader.js',
  './vendor/three/examples/jsm/loaders/OBJLoader.js',
  './vendor/three/examples/jsm/loaders/PLYLoader.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/loaders/USDLoader.js',
  './vendor/three/examples/jsm/loaders/USDZLoader.js',
  './vendor/three/examples/jsm/loaders/usd/USDAParser.js',
  './vendor/three/examples/jsm/loaders/usd/USDCParser.js',
  './vendor/three/examples/jsm/loaders/usd/USDComposer.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
  './vendor/three/examples/jsm/libs/fflate.module.js',
  './vendor/fflate/fflate.module.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // طلبات الـ API تذهب للشبكة دائمًا — لا تُخزَّن أبدًا
  if (new URL(e.request.url).pathname.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
