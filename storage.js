// تخزين دائم لنماذج المسح — يستخدم Supabase Storage (مجاني بدون بطاقة).
// كل الاتصال هنا في الخادم؛ المفتاح السري لا يصل للمتصفح أبدًا.
// يتحوّل تلقائيًا لوضع «معطّل» إن لم تُضبط المتغيرات، أو «ذاكرة» للاختبار.
const BUCKET = process.env.SUPABASE_BUCKET || 'scans';

let backend = null;

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    kind: 'supabase',
    async save(id, buffer) {
      const { error } = await client.storage.from(BUCKET)
        .upload(`${id}.zip`, buffer, { contentType: 'application/zip', upsert: true });
      if (error) throw new Error(error.message);
    },
    async list() {
      const { data, error } = await client.storage.from(BUCKET)
        .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
      if (error) throw new Error(error.message);
      return data
        .filter(o => o.name.endsWith('.zip'))
        .map(o => ({
          id: o.name.replace(/\.zip$/, ''),
          createdAt: o.created_at || o.updated_at || null,
          size: o.metadata && o.metadata.size != null ? o.metadata.size : null,
        }));
    },
    async get(id) {
      const { data, error } = await client.storage.from(BUCKET).download(`${id}.zip`);
      if (error) throw new Error(error.message);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(id) {
      const { error } = await client.storage.from(BUCKET).remove([`${id}.zip`]);
      if (error) throw new Error(error.message);
    },
  };
}

// خلفية ذاكرة للاختبار المحلي فقط (STORAGE_MEMORY=1) — لا تدوم بعد إعادة التشغيل
function initMemory() {
  const store = new Map();
  return {
    kind: 'memory',
    async save(id, buffer) { store.set(id, { buffer, createdAt: new Date().toISOString() }); },
    async list() {
      return [...store.entries()]
        .map(([id, v]) => ({ id, createdAt: v.createdAt, size: v.buffer.length }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async get(id) { const v = store.get(id); if (!v) throw new Error('غير موجود'); return v.buffer; },
    async remove(id) { store.delete(id); },
  };
}

try {
  backend = initSupabase();
  if (!backend && process.env.STORAGE_MEMORY === '1') backend = initMemory();
} catch (e) {
  console.log('storage init failed:', e.message);
}

exports.enabled = () => Boolean(backend);
exports.kind = () => (backend ? backend.kind : null);
exports.saveScan = (id, buf) => (backend ? backend.save(id, buf) : Promise.resolve());
exports.listScans = () => (backend ? backend.list() : Promise.resolve([]));
exports.getScan = (id) => (backend ? backend.get(id) : Promise.reject(new Error('التخزين معطّل')));
exports.deleteScan = (id) => (backend ? backend.remove(id) : Promise.resolve());
