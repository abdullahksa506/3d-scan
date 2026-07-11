// المعالجة السحابية: يرفع صور الالتقاط إلى الخادم (وسيط KIRI Engine)
// ويتابع الحالة حتى يجهز النموذج ثم يحمّله ويفتحه في العارض تلقائيًا.
import { unzipSync } from '../vendor/fflate/fflate.module.js';
import { getShots } from './capture.js';

const POLL_MS = 20000;
const STORE_KEY = 'kiri-pending-serialize';
const MAX_UPLOAD_DIM = 1920;   // نصغّر الصور قبل الرفع لتسريعه (يكفي للفوتوغرامتري)
const JPEG_QUALITY = 0.85;

const STATUS_TEXT = {
  '-1': '⬆️ جاري الرفع…',
  '0': '⚙️ جاري بناء النموذج… (يستغرق عادة 5–15 دقيقة)',
  '3': '⏳ في قائمة الانتظار…',
  '1': '❌ فشلت المعالجة — جرّب صورًا أوضح وبتداخل أكبر',
  '4': '⌛ انتهت صلاحية المهمة',
};

let els = {};
let toast, pollTimer = null;

export function initCloud(toastFn) {
  toast = toastFn;
  for (const id of ['cloud-card', 'cloud-unconfigured', 'cloud-controls', 'cloud-quality',
    'cloud-mask', 'btn-cloud-upload', 'cloud-status', 'btn-cloud-cancel']) {
    els[id] = document.getElementById(id);
  }

  els['btn-cloud-upload'].addEventListener('click', startUpload);
  els['btn-cloud-cancel'].addEventListener('click', () => {
    stopPolling();
    localStorage.removeItem(STORE_KEY);
    setStatus(null);
    toast('تم إيقاف متابعة المهمة');
  });
  window.addEventListener('shots-changed', updateButton);
  updateButton();
  checkHealth();
}

async function checkHealth() {
  try {
    const r = await fetch('api/kiri/health');
    if (!r.ok) throw new Error();
    const j = await r.json();
    if (!j.configured) {
      els['cloud-unconfigured'].hidden = false;
      els['cloud-controls'].hidden = true;
      return;
    }
    // مهمة سابقة لم تكتمل؟ تابعها
    const pending = localStorage.getItem(STORE_KEY);
    if (pending) {
      setStatus('↩️ استئناف متابعة مهمة سابقة…');
      startPolling(pending);
    }
  } catch {
    // نسخة ثابتة بدون خادم Node — أخفِ البطاقة
    els['cloud-card'].hidden = true;
  }
}

function updateButton() {
  const n = getShots().length;
  const btn = els['btn-cloud-upload'];
  if (!btn) return;
  btn.disabled = n < 20 || !!pollTimer;
  btn.textContent = n < 20
    ? `☁️ ارفع وعالج (تحتاج ${20 - n} صورة إضافية)`
    : `☁️ ارفع وعالج ${n} صورة`;
}

// تصغير الصورة قبل الرفع
async function shrink(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_UPLOAD_DIM / Math.max(bmp.width, bmp.height));
    if (scale === 1) { bmp.close(); return blob; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise(res => canvas.toBlob(b => res(b || blob), 'image/jpeg', JPEG_QUALITY));
  } catch {
    return blob;
  }
}

async function startUpload() {
  const shots = getShots();
  if (shots.length < 20) return;
  els['btn-cloud-upload'].disabled = true;
  setStatus(`📦 تجهيز ${shots.length} صورة…`);

  try {
    const fd = new FormData();
    for (let i = 0; i < shots.length; i++) {
      fd.append('imagesFiles', await shrink(shots[i].blob), `IMG_${String(i + 1).padStart(4, '0')}.jpg`);
      if (i % 10 === 9) setStatus(`📦 تجهيز الصور… ${i + 1}/${shots.length}`);
    }
    fd.append('modelQuality', els['cloud-quality'].value);
    fd.append('fileFormat', 'glb');
    fd.append('isMask', els['cloud-mask'].checked ? '1' : '0');

    setStatus('⬆️ جاري الرفع… (قد يستغرق دقائق حسب سرعة الاتصال)');
    const r = await fetch('api/kiri/upload', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

    localStorage.setItem(STORE_KEY, j.serialize);
    toast('تم الرفع ✓ — بدأت المعالجة السحابية');
    startPolling(j.serialize);
  } catch (e) {
    setStatus(`❌ ${e.message}`);
    els['btn-cloud-upload'].disabled = false;
  }
}

function startPolling(serialize) {
  stopPolling();
  els['btn-cloud-cancel'].hidden = false;
  const poll = async () => {
    try {
      const r = await fetch(`api/kiri/status/${serialize}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

      if (j.status === 2) {
        stopPolling();
        localStorage.removeItem(STORE_KEY);
        await downloadModel(serialize);
      } else if (j.status === 1 || j.status === 4) {
        stopPolling();
        localStorage.removeItem(STORE_KEY);
        setStatus(STATUS_TEXT[String(j.status)]);
        updateButton();
      } else {
        setStatus(STATUS_TEXT[String(j.status)] || `الحالة: ${j.status}`);
      }
    } catch (e) {
      setStatus(`⚠️ تعذر فحص الحالة (${e.message}) — سنعيد المحاولة`);
    }
  };
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  updateButton();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  els['btn-cloud-cancel'].hidden = true;
}

async function downloadModel(serialize) {
  setStatus('⬇️ اكتمل! جاري تنزيل النموذج…');
  try {
    const r = await fetch(`api/kiri/download/${serialize}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    const zipBuf = new Uint8Array(await r.arrayBuffer());
    const files = unzipSync(zipBuf);

    // ابحث عن ملف النموذج داخل الـ ZIP بأي صيغة مدعومة
    const priority = ['glb', 'gltf', 'obj', 'stl', 'ply', 'usdz'];
    let found = null;
    for (const ext of priority) {
      const name = Object.keys(files).find(f => f.toLowerCase().endsWith('.' + ext) && !f.startsWith('__MACOSX'));
      if (name) { found = { name, ext, data: files[name] }; break; }
    }
    if (!found) throw new Error('لم يتم العثور على ملف نموذج داخل الحزمة');

    setStatus('✅ تم! النموذج فُتح في تبويب «المعاينة»');
    toast('نموذج المسح جاهز ✓');
    window.dispatchEvent(new CustomEvent('import-model-buffer', {
      detail: { buffer: found.data.buffer, filename: `scan-${serialize.slice(0, 6)}.${found.ext}` },
    }));
    updateButton();
  } catch (e) {
    setStatus(`❌ فشل التنزيل: ${e.message}`);
    // أبقِ الرقم التسلسلي حتى يعيد المستخدم المحاولة
    localStorage.setItem(STORE_KEY, serialize);
    els['btn-cloud-cancel'].hidden = false;
  }
}

function setStatus(msg) {
  els['cloud-status'].hidden = !msg;
  els['cloud-status'].textContent = msg || '';
}
