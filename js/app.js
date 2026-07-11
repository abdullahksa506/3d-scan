import * as THREE from 'three';
import { STLLoader } from '../vendor/three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from '../vendor/three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from '../vendor/three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
import { initViewer, showGeometry, fitView, toggleWireframe, refresh } from './viewer.js';
import { analyzeGeometry, mergeByPosition } from './analysis.js';
import { exportSTL, exportOBJ, export3MF } from './exporters.js';
import { initCapture } from './capture.js';
import { initCalc, recalc } from './calc.js';
import { initLocal } from './local.js';

// ---------- الحالة ----------
let geometry = null;   // BufferGeometry الحالي (بالملليمتر)
let stats = null;      // نتيجة آخر فحص
let modelName = 'model';

// ---------- أدوات عامة ----------
const $ = id => document.getElementById(id);

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- التبويبات ----------
for (const btn of document.querySelectorAll('.tabbtn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${btn.dataset.tab}`));
  });
}

// ---------- العارض ----------
initViewer($('viewer'));

// ---------- تحميل الملفات ----------
const fileInput = $('file-input');
const fileDrop = $('file-drop');
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

async function loadFile(file) {
  return importBuffer(await file.arrayBuffer(), file.name);
}

async function importBuffer(buffer, filename) {
  const status = $('load-status');
  status.hidden = false;
  status.textContent = `⏳ جاري تحميل ${filename}…`;
  try {
    const ext = filename.split('.').pop().toLowerCase();
    let geo;

    if (ext === 'stl') {
      geo = new STLLoader().parse(buffer);
    } else if (ext === 'ply') {
      geo = new PLYLoader().parse(buffer);
    } else if (ext === 'obj') {
      const text = new TextDecoder().decode(buffer);
      geo = collectGeometries(new OBJLoader().parse(text));
    } else if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new Promise((res, rej) =>
        new GLTFLoader().parse(buffer, '', res, rej));
      geo = collectGeometries(gltf.scene);
    } else if (ext === 'usdz' || ext === 'usda' || ext === 'usdc') {
      const { USDLoader } = await import('../vendor/three/examples/jsm/loaders/USDLoader.js');
      const obj = new USDLoader().parse(buffer);
      geo = collectGeometries(obj);
    } else {
      throw new Error('صيغة غير مدعومة');
    }

    if (!geo || !geo.attributes.position || geo.attributes.position.count === 0) {
      throw new Error('لم يتم العثور على شبكة مثلثات في الملف');
    }

    setGeometry(geo, filename.replace(/\.[^.]+$/, ''));
    status.textContent = `✓ تم تحميل ${filename}`;
    // GLB/GLTF/USDZ غالبًا بالمتر — نحوّلها تلقائيًا إن بدت صغيرة جدًا
    autoDetectUnits(ext);
  } catch (e) {
    console.error(e);
    status.textContent = `✗ فشل التحميل: ${e.message || e}`;
    toast('تعذر قراءة الملف — جرّب صيغة أخرى (STL أو OBJ)');
  }
}

// يجمع كل الـ meshes من مشهد إلى BufferGeometry واحدة (مع تطبيق التحويلات)
function collectGeometries(root) {
  const geos = [];
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (node.isMesh && node.geometry?.attributes?.position) {
      let g = node.geometry.clone();
      // نحذف الخصائص غير المطلوبة حتى يقبل الدمج
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position') g.deleteAttribute(key);
      }
      g.applyMatrix4(node.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      geos.push(g);
    }
  });
  if (!geos.length) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  merged.computeVertexNormals();
  return merged;
}

function autoDetectUnits(ext) {
  if (!stats) return;
  const maxDim = Math.max(stats.dims.x, stats.dims.y, stats.dims.z);
  const hint = $('unit-hint');
  if ((ext === 'glb' || ext === 'gltf' || ext === 'usdz') && maxDim > 0 && maxDim < 5) {
    applyScale(1000);
    toast('يبدو أن النموذج بالمتر — تم تحويله تلقائيًا إلى ملم (×1000)');
    hint.hidden = true;
  } else if (maxDim > 0 && maxDim < 2) {
    hint.hidden = false;
    hint.innerHTML = 'النموذج صغير جدًا (<bdi>&lt;2 ملم</bdi>) — ربما وحداته بالمتر أو الإنش. حوّله من تبويب «التجهيز».';
  } else if (maxDim > 1000) {
    hint.hidden = false;
    hint.innerHTML = 'النموذج ضخم (<bdi>&gt;1 متر</bdi>) — تأكد من الوحدات في تبويب «التجهيز».';
  } else {
    hint.hidden = true;
  }
}

function setGeometry(geo, name) {
  geometry = geo;
  modelName = name || 'model';
  geometry.computeBoundingBox();
  showGeometry(geometry);
  $('viewer-empty').style.display = 'none';
  $('btn-wireframe').disabled = false;
  $('btn-fit').disabled = false;
  $('prep-empty-note').hidden = true;
  $('prep-tools').hidden = false;
  const badge = $('model-badge');
  badge.hidden = false;
  badge.textContent = modelName;
  runAnalysis();
}

// ---------- الفحص ----------
function runAnalysis() {
  if (!geometry) return;
  stats = analyzeGeometry(geometry);
  $('analysis-card').hidden = false;

  const f = x => x.toLocaleString('ar-SA', { maximumFractionDigits: 1 });
  $('st-dims').textContent = `${f(stats.dims.x)} × ${f(stats.dims.y)} × ${f(stats.dims.z)} mm`;
  $('st-volume').textContent = `${f(stats.volumeMM3 / 1000)} cm³`;
  $('st-area').textContent = `${f(stats.areaMM2 / 100)} cm²`;
  $('st-tris').textContent = stats.triCount.toLocaleString('ar-SA');
  $('st-holes').textContent = stats.boundaryEdges.toLocaleString('ar-SA');
  $('st-nonmanifold').textContent = stats.nonManifoldEdges.toLocaleString('ar-SA');
  $('st-watertight').textContent = stats.watertight ? 'نعم ✓' : 'لا ✗';

  const banner = $('health-banner');
  if (stats.watertight && !stats.flipped) {
    banner.className = 'health ok';
    banner.textContent = '✅ النموذج سليم وجاهز للطباعة';
  } else if (stats.watertight && stats.flipped) {
    banner.className = 'health warn';
    banner.textContent = '⚠️ اتجاهات الأسطح معكوسة — استخدم «إعادة حساب الاتجاهات» في التجهيز';
  } else if (stats.boundaryEdges > 0 && stats.boundaryEdges <= 60) {
    banner.className = 'health warn';
    banner.textContent = `⚠️ يوجد ${stats.boundaryEdges} حافة مفتوحة (ثقوب صغيرة) — أغلب برامج التقطيع ستصلحها تلقائيًا`;
  } else {
    banner.className = 'health bad';
    banner.textContent = '❌ النموذج غير مغلق — يحتاج إصلاحًا قبل الطباعة (جرّب دمج النقاط، أو أصلحه في PrusaSlicer/Meshmixer)';
  }

  recalc();
}

// ---------- أدوات العارض ----------
$('btn-wireframe').addEventListener('click', () => toggleWireframe());
$('btn-fit').addEventListener('click', () => fitView());
$('btn-demo').addEventListener('click', () => {
  const geo = new THREE.TorusKnotGeometry(20, 6.5, 220, 36);
  geo.rotateX(Math.PI / 2);
  const merged = mergeByPosition(geo);
  merged.computeVertexNormals();
  setGeometry(merged, 'demo-torus-knot');
  toast('تم إنشاء نموذج تجريبي للتجربة');
});

// ---------- التجهيز ----------
function applyScale(factor) {
  if (!geometry) return;
  geometry.scale(factor, factor, factor);
  afterEdit();
}

document.querySelectorAll('[data-scale]').forEach(btn =>
  btn.addEventListener('click', () => {
    applyScale(Number(btn.dataset.scale));
    toast(`تم التحجيم ×${btn.dataset.scale}`);
  }));

$('btn-scale-to').addEventListener('click', () => {
  const target = Number($('target-size').value);
  if (!geometry || !target || target <= 0) { toast('أدخل قيمة صحيحة بالملم'); return; }
  geometry.computeBoundingBox();
  const s = new THREE.Vector3();
  geometry.boundingBox.getSize(s);
  const maxDim = Math.max(s.x, s.y, s.z);
  if (!maxDim) return;
  applyScale(target / maxDim);
  toast(`أصبح أكبر بُعد ${target} ملم`);
});

document.querySelectorAll('[data-rot]').forEach(btn =>
  btn.addEventListener('click', () => {
    if (!geometry) return;
    const axis = btn.dataset.rot;
    if (axis === 'x') geometry.rotateX(Math.PI / 2);
    if (axis === 'y') geometry.rotateY(Math.PI / 2);
    if (axis === 'z') geometry.rotateZ(Math.PI / 2);
    afterEdit();
  }));

$('btn-lay-flat').addEventListener('click', () => {
  if (!geometry) return;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  geometry.translate(-cx, -cy, -box.min.z);
  afterEdit();
  toast('تم التوسيط والإنزال على سطح الطباعة');
});

$('btn-fix-normals').addEventListener('click', () => {
  if (!geometry) return;
  if (stats?.flipped) {
    // قلب ترتيب النقاط في كل مثلث لعكس الاتجاهات
    flipWinding(geometry);
  }
  geometry.computeVertexNormals();
  afterEdit();
  toast('تمت إعادة حساب الاتجاهات');
});

function flipWinding(geo) {
  if (geo.index) {
    const idx = geo.index;
    for (let t = 0; t < idx.count; t += 3) {
      const tmp = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, tmp);
    }
    idx.needsUpdate = true;
  } else {
    const pos = geo.attributes.position;
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      v.fromBufferAttribute(pos, t + 1);
      w.fromBufferAttribute(pos, t + 2);
      pos.setXYZ(t + 1, w.x, w.y, w.z);
      pos.setXYZ(t + 2, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  }
}

$('btn-merge-verts').addEventListener('click', () => {
  if (!geometry) return;
  const before = geometry.attributes.position.count;
  const merged = mergeByPosition(geometry);
  merged.computeVertexNormals();
  setGeometry(merged, modelName);
  toast(`دمج النقاط: ${before.toLocaleString('ar-SA')} ← ${merged.attributes.position.count.toLocaleString('ar-SA')}`);
});

function afterEdit() {
  geometry.attributes.position.needsUpdate = true;
  if (geometry.attributes.normal) geometry.attributes.normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  refresh();
  fitView();
  runAnalysis();
}

// ---------- التصدير ----------
$('btn-export-stl').addEventListener('click', () => geometry && (exportSTL(geometry, modelName), toast('تم تصدير STL ✓')));
$('btn-export-obj').addEventListener('click', () => geometry && (exportOBJ(geometry, modelName), toast('تم تصدير OBJ ✓')));
$('btn-export-3mf').addEventListener('click', () => geometry && (export3MF(geometry, modelName), toast('تم تصدير 3MF ✓')));

// ---------- الوحدات الأخرى ----------
initCapture(toast);
initCalc(() => stats);
initLocal(toast);

// استقبال نموذج جاهز من المعالجة السحابية → فتحه والانتقال للمعاينة
window.addEventListener('import-model-buffer', async (e) => {
  document.querySelector('[data-tab="view"]').click();
  await importBuffer(e.detail.buffer, e.detail.filename);
});

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
