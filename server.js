// خادم بسيط: يقدّم الموقع الثابت + طابور مهام يربط الآيفون بكمبيوترك المنزلي.
//
// الفكرة: كمبيوترك (خلف الراوتر) لا يمكن للسيرفر الاتصال به مباشرة، لذلك
// نقلب الاتجاه: «الوكيل» على كمبيوترك هو من يسأل السيرفر ويرسل نبضة حياة.
//   الآيفون → يرفع الصور هنا (طابور)
//   الوكيل  → ينبض + يسحب المهمة + يعالج بـ RealityScan + يرفع النموذج
//   الآيفون → يفتح النموذج تلقائيًا
const express = require('express');
const multer = require('multer');
const path = require('path');
const { zipSync } = require('fflate');

const app = express();
const PORT = process.env.PORT || 8000;
const AGENT_TOKEN = process.env.AGENT_TOKEN;      // سر مشترك بينك وبين الوكيل
const MIN_PHOTOS = 15;
const JOB_TTL_MS = 60 * 60 * 1000;                // تُحذف المهمة بعد ساعة
const HEARTBEAT_ONLINE_MS = 15000;                // يُعتبر الكمبيوتر متصلًا إن نبض خلال 15 ثانية

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 300, fileSize: 20 * 1024 * 1024 },
});

// ---------- الحالة في الذاكرة ----------
const jobs = new Map(); // id -> { id, status, quality, photos:[{name,buf}], result:Buffer, error, createdAt, updatedAt }
let lastHeartbeat = 0;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const agentOnline = () => Date.now() - lastHeartbeat < HEARTBEAT_ONLINE_MS;

function touch(job) { job.updatedAt = Date.now(); }
function cleanup() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.updatedAt > JOB_TTL_MS) jobs.delete(id);
}
setInterval(cleanup, 5 * 60 * 1000).unref?.();

// حماية مسارات الوكيل بالتوكن المشترك
function agentAuth(req, res, next) {
  if (!AGENT_TOKEN) return res.status(503).json({ error: 'AGENT_TOKEN غير مضبوط في إعدادات الخادم' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token !== AGENT_TOKEN) return res.status(401).json({ error: 'توكن غير صحيح' });
  next();
}

// ============ مسارات الآيفون (الموقع) ============

// هل الميزة مفعّلة على هذا الخادم أصلًا؟ وهل الكمبيوتر متصل؟
app.get('/api/local/agent-status', (req, res) => {
  res.json({
    enabled: Boolean(AGENT_TOKEN),
    online: agentOnline(),
    lastSeenSeconds: lastHeartbeat ? Math.round((Date.now() - lastHeartbeat) / 1000) : null,
  });
});

// رفع الصور وإنشاء مهمة
app.post('/api/local/upload', upload.array('photos', 300), (req, res) => {
  if (!AGENT_TOKEN) return res.status(503).json({ error: 'المعالجة المحلية غير مفعّلة على الخادم' });
  const files = req.files || [];
  if (files.length < MIN_PHOTOS) {
    return res.status(400).json({ error: `يلزم ${MIN_PHOTOS} صورة على الأقل (المرفوع: ${files.length})` });
  }
  const id = newId();
  jobs.set(id, {
    id,
    status: 'queued',
    quality: ['high', 'normal', 'low'].includes(req.body.quality) ? req.body.quality : 'normal',
    photos: files.map((f, i) => ({ name: f.originalname || `IMG_${i + 1}.jpg`, buf: f.buffer })),
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  res.json({ jobId: id, queuedBehind: [...jobs.values()].filter(j => j.status === 'queued').length - 1, agentOnline: agentOnline() });
});

// حالة المهمة
app.get('/api/local/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'المهمة غير موجودة (ربما انتهت صلاحيتها)' });
  res.json({ status: job.status, error: job.error, agentOnline: agentOnline() });
});

// تنزيل النموذج الناتج (ZIP كما رفعه الوكيل)
app.get('/api/local/result/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.result) return res.status(404).json({ error: 'النتيجة غير جاهزة' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="model.zip"');
  res.end(job.result);
});

// ============ مسارات الوكيل (كمبيوترك) ============

// نبضة حياة — تُحدّث حالة الاتصال وتخبر الوكيل إن كان هناك عمل
app.post('/api/agent/heartbeat', agentAuth, (req, res) => {
  lastHeartbeat = Date.now();
  const pending = [...jobs.values()].some(j => j.status === 'queued');
  res.json({ ok: true, hasJob: pending });
});

// اسحب المهمة التالية (يعلّمها «قيد المعالجة»)
app.get('/api/agent/next', agentAuth, (req, res) => {
  lastHeartbeat = Date.now();
  const job = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt).find(j => j.status === 'queued');
  if (!job) return res.status(204).end();
  job.status = 'processing';
  touch(job);
  res.json({ id: job.id, quality: job.quality, photoCount: job.photos.length });
});

// نزّل صور المهمة كملف ZIP
app.get('/api/agent/photos/:id', agentAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'المهمة غير موجودة' });
  const files = {};
  for (const p of job.photos) files[p.name] = [p.buf, { level: 0 }];
  const zipped = zipSync(files);
  res.setHeader('Content-Type', 'application/zip');
  res.end(Buffer.from(zipped));
});

// ارفع النموذج الناتج (جسم الطلب = ZIP خام)
app.post('/api/agent/result/:id', agentAuth,
  express.raw({ type: '*/*', limit: '200mb' }),
  (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'جسم فارغ' });
    job.result = req.body;
    job.status = 'done';
    touch(job);
    res.json({ ok: true });
  });

// أبلغ عن فشل المعالجة
app.post('/api/agent/fail/:id', agentAuth, express.json(), (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'المهمة غير موجودة' });
  job.status = 'failed';
  job.error = (req.body && req.body.error) || 'فشلت المعالجة على الكمبيوتر';
  touch(job);
  res.json({ ok: true });
});

// ============ الملفات الثابتة ============
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(`${path.sep}vendor${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.listen(PORT, () => {
  console.log(`3d-scan server on :${PORT} — المعالجة المحلية ${AGENT_TOKEN ? 'مفعّلة ✓' : 'غير مضبوطة (عيّن AGENT_TOKEN) ✗'}`);
});
