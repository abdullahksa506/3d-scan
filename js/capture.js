import { zipSync } from '../vendor/fflate/fflate.module.js';
import { downloadBlob } from './exporters.js';

const SEGMENTS = 24; // قطاعات دائرة التغطية

const els = {};
let stream = null;
let shots = [];              // { blob, url, heading }
let heading = null;          // اتجاه البوصلة الحالي (درجات) أو null
let motionEnabled = false;

export function initCapture(toast) {
  for (const id of ['camera', 'camera-off', 'btn-start-camera', 'btn-stop-camera', 'btn-enable-motion',
    'btn-shoot', 'btn-export-zip', 'btn-clear-shots', 'thumbs', 'shot-count', 'coverage-pct', 'coverage-ring']) {
    els[id] = document.getElementById(id);
  }

  els['btn-start-camera'].addEventListener('click', () => startCamera(toast));
  els['btn-stop-camera'].addEventListener('click', stopCamera);
  els['btn-shoot'].addEventListener('click', () => shoot(toast));
  els['btn-export-zip'].addEventListener('click', () => exportZip(toast));
  els['btn-clear-shots'].addEventListener('click', clearShots);
  els['btn-enable-motion'].addEventListener('click', () => requestMotion(toast));

  // iOS يتطلب طلب إذن صريح لحساس الاتجاه
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    els['btn-enable-motion'].hidden = false;
  } else if (typeof DeviceOrientationEvent !== 'undefined') {
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    motionEnabled = true;
  }
  drawRing();
}

async function startCamera(toast) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('المتصفح لا يدعم الكاميرا — تأكد أن الموقع يعمل عبر HTTPS');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1920 } },
      audio: false,
    });
    els.camera.srcObject = stream;
    els['camera-off'].hidden = true;
    els['btn-shoot'].disabled = false;
    els['btn-stop-camera'].disabled = false;
  } catch (e) {
    toast('تعذر فتح الكاميرا: ' + (e.name === 'NotAllowedError' ? 'الإذن مرفوض' : e.message));
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  els.camera.srcObject = null;
  els['camera-off'].hidden = false;
  els['btn-shoot'].disabled = true;
  els['btn-stop-camera'].disabled = true;
}

async function requestMotion(toast) {
  try {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res === 'granted') {
      window.addEventListener('deviceorientation', onOrientation);
      motionEnabled = true;
      els['btn-enable-motion'].hidden = true;
      toast('تم تفعيل عدّاد التغطية ✓');
    }
  } catch {
    toast('تعذر تفعيل حساس الاتجاه');
  }
}

function onOrientation(e) {
  const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : e.alpha);
  if (h != null && !Number.isNaN(h)) {
    heading = ((h % 360) + 360) % 360;
    drawRing();
  }
}

function shoot(toast) {
  const video = els.camera;
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    shots.push({ blob, url, heading });
    addThumb(shots.length - 1, url);
    updateStats();
    drawRing();
    if (navigator.vibrate) navigator.vibrate(30);
    if (shots.length === 40) toast('ممتاز! 40 صورة — أكمل دورة من زاوية أعلى 👍');
  }, 'image/jpeg', 0.92);
}

function addThumb(i, url) {
  const div = document.createElement('div');
  div.className = 'thumb';
  div.dataset.idx = i;
  const img = document.createElement('img');
  img.src = url;
  img.alt = `صورة ${i + 1}`;
  const del = document.createElement('button');
  del.textContent = '✕';
  del.setAttribute('aria-label', 'حذف الصورة');
  del.addEventListener('click', () => {
    const idx = Number(div.dataset.idx);
    URL.revokeObjectURL(shots[idx].url);
    shots.splice(idx, 1);
    rebuildThumbs();
    updateStats();
    drawRing();
  });
  div.append(img, del);
  els.thumbs.appendChild(div);
}

function rebuildThumbs() {
  els.thumbs.innerHTML = '';
  shots.forEach((s, i) => addThumb(i, s.url));
}

function clearShots() {
  shots.forEach(s => URL.revokeObjectURL(s.url));
  shots = [];
  rebuildThumbs();
  updateStats();
  drawRing();
}

function updateStats() {
  els['shot-count'].textContent = `${shots.length} صورة`;
  const covered = coveredSegments();
  els['coverage-pct'].textContent = motionEnabled && shots.length
    ? `التغطية: ${Math.round(covered.size / SEGMENTS * 100)}٪`
    : `الهدف: 40–80 صورة`;
  const has = shots.length > 0;
  els['btn-export-zip'].disabled = !has;
  els['btn-clear-shots'].disabled = !has;
}

function coveredSegments() {
  const set = new Set();
  for (const s of shots) {
    if (s.heading != null) set.add(Math.floor(s.heading / (360 / SEGMENTS)) % SEGMENTS);
  }
  return set;
}

function drawRing() {
  const canvas = els['coverage-ring'];
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!motionEnabled) return;

  const cx = w / 2, cy = h - 64, r = 42;
  const covered = coveredSegments();
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.85) / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.strokeStyle = covered.has(i) ? 'rgba(63,185,80,.95)' : 'rgba(255,255,255,.28)';
    ctx.stroke();
  }
  // مؤشر الاتجاه الحالي
  if (heading != null) {
    const a = (heading / 360) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#4d9fff';
    ctx.fill();
  }
}

async function exportZip(toast) {
  if (!shots.length) return;
  toast('جاري ضغط الصور…');
  const files = {};
  for (let i = 0; i < shots.length; i++) {
    const buf = new Uint8Array(await shots[i].blob.arrayBuffer());
    files[`IMG_${String(i + 1).padStart(4, '0')}.jpg`] = buf;
  }
  // JPEG مضغوط أصلًا — بدون ضغط إضافي (أسرع بكثير)
  const zipped = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), 'scan_photos.zip');
  toast(`تم تصدير ${shots.length} صورة ✓ — عالجها في تطبيق photogrammetry ثم استورد النتيجة`);
}
