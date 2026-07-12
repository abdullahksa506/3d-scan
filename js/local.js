// المعالجة على جهازك: يرفع صور الالتقاط إلى الخادم (طابور مهام)، ويتابع
// حتى يعالجها كمبيوترك المنزلي بـ RealityScan ويرفع النموذج، ثم يفتحه تلقائيًا.
import { getShots } from './capture.js';
import { openModelFromZip } from './modelzip.js';

const POLL_MS = 8000;             // متابعة حالة المهمة
const AGENT_POLL_MS = 5000;       // متابعة اتصال الكمبيوتر
const STORE_KEY = 'local-pending-job';
const MAX_UPLOAD_DIM = 2048;      // نصغّر الصور قبل الرفع (يكفي للفوتوغرامتري)
const JPEG_QUALITY = 0.88;

let els = {};
let toast, statusTimer = null, agentTimer = null;

export function initLocal(toastFn) {
  toast = toastFn;
  for (const id of ['local-card', 'local-no-server', 'local-controls', 'local-quality',
    'agent-dot', 'agent-status-text', 'btn-local-upload', 'local-status', 'btn-local-cancel']) {
    els[id] = document.getElementById(id);
  }

  els['btn-local-upload'].addEventListener('click', startUpload);
  els['btn-local-cancel'].addEventListener('click', () => {
    stopStatusPolling();
    localStorage.removeItem(STORE_KEY);
    setStatus(null);
    updateButton();
    toast('تم إيقاف متابعة المهمة');
  });
  window.addEventListener('shots-changed', updateButton);

  boot();
}

async function boot() {
  // تحقق أول مرة: هل يوجد خادم Node أصلًا؟ وهل الميزة مفعّلة؟
  try {
    const s = await fetchAgentStatus();
    if (!s.enabled) {
      els['local-no-server'].hidden = false;
      els['local-controls'].hidden = true;
      return;
    }
  } catch {
    // استضافة ثابتة بدون خادم → أخفِ البطاقة كليًا
    els['local-card'].hidden = true;
    return;
  }

  // تابع حالة اتصال الكمبيوتر باستمرار
  refreshAgent();
  agentTimer = setInterval(refreshAgent, AGENT_POLL_MS);

  // استئناف مهمة سابقة لم تكتمل
  const pending = localStorage.getItem(STORE_KEY);
  if (pending) {
    setStatus('↩️ استئناف متابعة مهمة سابقة…');
    startStatusPolling(pending);
  }
  updateButton();
}

function fetchAgentStatus() {
  return fetch('api/local/agent-status').then(r => {
    if (!r.ok) throw new Error();
    return r.json();
  });
}

let agentIsOnline = false;
async function refreshAgent() {
  try {
    const s = await fetchAgentStatus();
    agentIsOnline = s.online;
    els['agent-dot'].className = 'dot ' + (s.online ? 'on' : 'off');
    els['agent-status-text'].textContent = s.online
      ? '🟢 الكمبيوتر متصل وجاهز للمعالجة'
      : (s.lastSeenSeconds != null
          ? `🔴 الكمبيوتر غير متصل (آخر ظهور قبل ${fmtAgo(s.lastSeenSeconds)})`
          : '🔴 الكمبيوتر غير متصل — شغّل الوكيل على جهازك');
  } catch {
    agentIsOnline = false;
    els['agent-dot'].className = 'dot off';
    els['agent-status-text'].textContent = '⚠️ تعذر الوصول للخادم';
  }
  updateButton();
}

function updateButton() {
  const n = getShots().length;
  const btn = els['btn-local-upload'];
  if (!btn) return;
  const busy = !!statusTimer;
  btn.disabled = n < 15 || busy;
  if (busy) {
    btn.textContent = '⏳ قيد المعالجة…';
  } else if (n < 15) {
    btn.textContent = `💻 أرسل للمعالجة (تحتاج ${15 - n} صورة إضافية)`;
  } else if (!agentIsOnline) {
    btn.textContent = `💻 أرسل ${n} صورة (ستُعالج حين يعمل الكمبيوتر)`;
  } else {
    btn.textContent = `💻 أرسل ${n} صورة للمعالجة على جهازي`;
  }
}

// تصغير الصورة قبل الرفع لتسريعه
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
  if (shots.length < 15) return;
  els['btn-local-upload'].disabled = true;
  setStatus(`📦 تجهيز ${shots.length} صورة…`);

  try {
    const fd = new FormData();
    for (let i = 0; i < shots.length; i++) {
      fd.append('photos', await shrink(shots[i].blob), `IMG_${String(i + 1).padStart(4, '0')}.jpg`);
      if (i % 10 === 9) setStatus(`📦 تجهيز الصور… ${i + 1}/${shots.length}`);
    }
    fd.append('quality', els['local-quality'].value);

    setStatus('⬆️ جاري الرفع…');
    const r = await fetch('api/local/upload', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

    localStorage.setItem(STORE_KEY, j.jobId);
    toast(j.agentOnline ? 'تم الرفع ✓ — بدأت المعالجة على جهازك' : 'تم الرفع ✓ — بانتظار تشغيل الكمبيوتر');
    startStatusPolling(j.jobId);
  } catch (e) {
    setStatus(`❌ ${e.message}`);
    updateButton();
  }
}

function startStatusPolling(jobId) {
  stopStatusPolling();
  els['btn-local-cancel'].hidden = false;
  const poll = async () => {
    try {
      const r = await fetch(`api/local/status/${jobId}`);
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error(j.error || 'انتهت صلاحية المهمة');
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

      if (j.status === 'queued') {
        setStatus(j.agentOnline ? '⏳ في الطابور — سيبدأ الكمبيوتر قريبًا…' : '⏳ بانتظار تشغيل الكمبيوتر (شغّل الوكيل على جهازك)…');
      } else if (j.status === 'processing') {
        setStatus('⚙️ يعالج RealityScan على جهازك… (عادة 3–15 دقيقة حسب عدد الصور)');
      } else if (j.status === 'done') {
        stopStatusPolling();
        localStorage.removeItem(STORE_KEY);
        await downloadModel(jobId);
      } else if (j.status === 'failed') {
        stopStatusPolling();
        localStorage.removeItem(STORE_KEY);
        setStatus(`❌ ${j.error || 'فشلت المعالجة'} — جرّب صورًا أوضح وبتداخل أكبر`);
        updateButton();
      }
    } catch (e) {
      stopStatusPolling();
      localStorage.removeItem(STORE_KEY);
      setStatus(`❌ ${e.message}`);
      updateButton();
    }
  };
  poll();
  statusTimer = setInterval(poll, POLL_MS);
  updateButton();
}

function stopStatusPolling() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = null;
  els['btn-local-cancel'].hidden = true;
}

async function downloadModel(jobId) {
  setStatus('⬇️ اكتمل! جاري تنزيل النموذج…');
  try {
    const r = await fetch(`api/local/result/${jobId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const zipBuf = new Uint8Array(await r.arrayBuffer());
    openModelFromZip(zipBuf, `scan-${jobId.slice(-6)}`);

    setStatus('✅ تم! النموذج فُتح في تبويب «المعاينة»');
    toast('نموذج المسح جاهز ✓');
    // نبّه المعرض ليحدّث قائمته (المسحة صارت محفوظة)
    window.dispatchEvent(new CustomEvent('scan-saved'));
    updateButton();
  } catch (e) {
    setStatus(`❌ فشل التنزيل: ${e.message}`);
    localStorage.setItem(STORE_KEY, jobId);
    els['btn-local-cancel'].hidden = false;
  }
}

function fmtAgo(sec) {
  if (sec < 60) return `${sec} ثانية`;
  if (sec < 3600) return `${Math.round(sec / 60)} دقيقة`;
  return `${Math.round(sec / 3600)} ساعة`;
}

function setStatus(msg) {
  els['local-status'].hidden = !msg;
  els['local-status'].textContent = msg || '';
}
