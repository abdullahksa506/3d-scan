// خادم بسيط: يقدّم الموقع الثابت + وسيط آمن لـ KIRI Engine API
// المفتاح يبقى سرًا هنا في الخادم (متغير البيئة KIRI_API_KEY) ولا يصل للمتصفح أبدًا.
const express = require('express');
const multer = require('multer');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8000;
const KIRI_BASE = process.env.KIRI_API_BASE || 'https://api.kiriengine.app/api/v1/open';
const API_KEY = process.env.KIRI_API_KEY;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 300, fileSize: 15 * 1024 * 1024 },
});

const auth = () => ({ Authorization: `Bearer ${API_KEY}` });

// هل الخدمة السحابية مفعّلة؟
app.get('/api/kiri/health', (req, res) => {
  res.json({ configured: Boolean(API_KEY) });
});

// رفع الصور وبدء المعالجة
app.post('/api/kiri/upload', upload.array('imagesFiles', 300), async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: 'KIRI_API_KEY غير مضبوط في إعدادات الخادم' });
    const files = req.files || [];
    if (files.length < 20) return res.status(400).json({ error: `KIRI يتطلب 20 صورة على الأقل (المرفوع: ${files.length})` });

    const fd = new FormData();
    for (const f of files) {
      fd.append('imagesFiles', new Blob([f.buffer], { type: f.mimetype || 'image/jpeg' }), f.originalname || 'photo.jpg');
    }
    fd.append('modelQuality', String(req.body.modelQuality ?? '0'));
    fd.append('textureQuality', String(req.body.textureQuality ?? '2')); // 1K يكفي لأغراض الطباعة
    fd.append('fileFormat', String(req.body.fileFormat || 'glb'));
    fd.append('isMask', String(req.body.isMask ?? '1'));

    const r = await fetch(`${KIRI_BASE}/photo/image`, { method: 'POST', headers: auth(), body: fd });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      return res.status(502).json({ error: j?.msg || `KIRI رفض الطلب (HTTP ${r.status})`, code: j?.code });
    }
    res.json({ serialize: j.data.serialize });
  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ error: 'فشل الرفع إلى KIRI: ' + e.message });
  }
});

// حالة المعالجة: -1 رفع، 0 معالجة، 3 انتظار، 2 نجاح، 1 فشل، 4 منتهي
app.get('/api/kiri/status/:serialize', async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: 'KIRI_API_KEY غير مضبوط' });
    const r = await fetch(`${KIRI_BASE}/model/getStatus?serialize=${encodeURIComponent(req.params.serialize)}`, { headers: auth() });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return res.status(502).json({ error: j?.msg || `HTTP ${r.status}` });
    res.json({ status: j.data.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تنزيل النموذج الجاهز (نمرر الملف عبر الخادم لتفادي مشاكل CORS)
app.get('/api/kiri/download/:serialize', async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: 'KIRI_API_KEY غير مضبوط' });
    const r = await fetch(`${KIRI_BASE}/model/getModelZip?serialize=${encodeURIComponent(req.params.serialize)}`, { headers: auth() });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok || !j.data?.modelUrl) return res.status(502).json({ error: j?.msg || `HTTP ${r.status}` });

    const zip = await fetch(j.data.modelUrl);
    if (!zip.ok) return res.status(502).json({ error: `فشل تنزيل الملف (HTTP ${zip.status})` });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="model.zip"');
    Readable.fromWeb(zip.body).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// الملفات الثابتة مع سياسات كاش مناسبة
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(`${path.sep}vendor${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.listen(PORT, () => console.log(`3d-scan server on :${PORT} — KIRI ${API_KEY ? 'مفعّل ✓' : 'غير مضبوط ✗'}`));
