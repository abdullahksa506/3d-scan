// معرض المسحات المحفوظة — يقرأ من الخادم (Supabase عبر مسارات /api/scans)
// ويفتح أي مسحة في العارض، أو يحذفها.
import { openModelFromZip } from './modelzip.js';

let els = {};
let toast;
let enabled = false;

export function initGallery(toastFn) {
  toast = toastFn;
  els.tabbtn = document.querySelector('.tabbtn[data-tab="gallery"]');
  els.list = document.getElementById('gallery-list');
  els.note = document.getElementById('gallery-note');
  els.refresh = document.getElementById('btn-gallery-refresh');

  els.refresh.addEventListener('click', () => refresh(true));
  // حدّث عند فتح التبويب
  els.tabbtn.addEventListener('click', () => { if (enabled) refresh(); });
  // حدّث عند اكتمال مسحة جديدة
  window.addEventListener('scan-saved', () => setTimeout(() => refresh(), 1500));

  boot();
}

async function boot() {
  try {
    const r = await fetch('api/scans');
    if (!r.ok) throw new Error();
    const j = await r.json();
    enabled = j.enabled;
    els.tabbtn.hidden = !enabled;      // أظهر التبويب فقط إن كان المعرض مفعّلًا
    if (enabled) render(j.scans);
  } catch {
    enabled = false;
    els.tabbtn.hidden = true;
  }
}

async function refresh(showToast) {
  if (!enabled) return;
  els.note.textContent = 'جارٍ التحديث…';
  try {
    const r = await fetch('api/scans');
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    render(j.scans);
    if (showToast) toast(`${j.scans.length} مسحة محفوظة`);
  } catch (e) {
    els.note.textContent = `تعذر التحميل: ${e.message}`;
  }
}

function render(scans) {
  els.note.textContent = scans.length
    ? 'مسحاتك المحفوظة — افتح أيًا منها في أي وقت.'
    : 'لا توجد مسحات محفوظة بعد. أول مسحة ناجحة راح تظهر هنا تلقائيًا.';
  els.list.innerHTML = '';
  for (const s of scans) {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    const info = document.createElement('div');
    info.className = 'gi-info';
    const title = document.createElement('div');
    title.className = 'gi-title';
    title.textContent = `مسحة ${s.id.slice(-6)}`;
    const sub = document.createElement('div');
    sub.className = 'gi-sub';
    sub.textContent = [fmtDate(s.createdAt), fmtSize(s.size)].filter(Boolean).join(' · ');
    info.append(title, sub);

    const openBtn = document.createElement('button');
    openBtn.className = 'btn ghost small';
    openBtn.textContent = 'فتح';
    openBtn.addEventListener('click', () => openScan(s.id, openBtn));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger small';
    delBtn.textContent = 'حذف';
    delBtn.addEventListener('click', () => deleteScan(s.id, item));

    item.append(info, openBtn, delBtn);
    els.list.appendChild(item);
  }
}

async function openScan(id, btn) {
  const old = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const r = await fetch(`api/scans/${id}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    openModelFromZip(buf, `scan-${id.slice(-6)}`);
    document.querySelector('.tabbtn[data-tab="view"]').click();
    toast('تم فتح المسحة في المعاينة ✓');
  } catch (e) {
    toast(`تعذر الفتح: ${e.message}`);
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
}

async function deleteScan(id, item) {
  if (!confirm('حذف هذه المسحة نهائيًا؟')) return;
  try {
    const r = await fetch(`api/scans/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    item.remove();
    toast('تم الحذف');
  } catch (e) {
    toast(`تعذر الحذف: ${e.message}`);
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ميجابايت`;
}
