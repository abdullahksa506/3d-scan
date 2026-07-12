// قص الأرضية تلقائيًا: يكتشف أكبر سطح مستوٍ (الأرضية) ويزيله مع كل ما تحته،
// مع الحفاظ على كل الخصائص (الألوان/التكستور/الإحداثيات) للجزء المتبقّي.
import * as THREE from 'three';

export function autoCropFloor(geometry) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = geo.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  if (triCount < 50) return null;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();

  // بيانات كل مثلث + هستوغرام لاتجاهات الأسطح (موزون بالمساحة)
  const tri = new Array(triCount);
  const bins = new Map();
  const q = 0.15;
  let totalArea = 0;

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    const area = n.length() / 2;
    if (area < 1e-9) { tri[t] = { area: 0 }; continue; }
    n.multiplyScalar(1 / (area * 2));
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    tri[t] = { nx: n.x, ny: n.y, nz: n.z, cx, cy, cz, area };
    totalArea += area;
    const key = `${Math.round(n.x / q)},${Math.round(n.y / q)},${Math.round(n.z / q)}`;
    let bin = bins.get(key);
    if (!bin) { bin = { x: 0, y: 0, z: 0, area: 0 }; bins.set(key, bin); }
    bin.x += n.x * area; bin.y += n.y * area; bin.z += n.z * area; bin.area += area;
  }

  // الاتجاه المهيمن = اتجاه الأرضية (أكبر مساحة أسطح متوازية)
  let best = null;
  for (const bin of bins.values()) if (!best || bin.area > best.area) best = bin;
  if (!best || best.area < totalArea * 0.15) return null; // لا يوجد سطح أرضية واضح
  const fn = new THREE.Vector3(best.x, best.y, best.z).normalize();

  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // إزاحة مستوى الأرضية = القيمة الأكثر شيوعًا بين الأسطح الموازية للأرضية
  const binW = maxDim * 0.02;
  const offBins = new Map();
  for (let t = 0; t < triCount; t++) {
    const d = tri[t]; if (!d.area) continue;
    if (Math.abs(d.nx * fn.x + d.ny * fn.y + d.nz * fn.z) > 0.85) {
      const off = d.cx * fn.x + d.cy * fn.y + d.cz * fn.z;
      const k = Math.round(off / binW);
      offBins.set(k, (offBins.get(k) || 0) + d.area);
    }
  }
  if (!offBins.size) return null;
  let bestK = 0, bestA = -1;
  for (const [k, ar] of offBins) if (ar > bestA) { bestA = ar; bestK = k; }
  const floorOffset = bestK * binW;

  // أي جهة فيها الجسم؟ (الأبعد عن المستوى)
  let maxS = -Infinity, minS = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const s = v.dot(fn) - floorOffset;
    if (s > maxS) maxS = s;
    if (s < minS) minS = s;
  }
  const objectPositive = Math.abs(maxS) >= Math.abs(minS);
  const thresh = maxDim * 0.02;

  // أبقِ المثلثات في جهة الجسم وفوق عتبة الأرضية
  const keep = new Uint8Array(triCount);
  let kept = 0;
  for (let t = 0; t < triCount; t++) {
    const d = tri[t]; if (!d.area) continue;
    const s = (d.cx * fn.x + d.cy * fn.y + d.cz * fn.z) - floorOffset;
    const ok = objectPositive ? s > thresh : s < -thresh;
    if (ok) { keep[t] = 1; kept++; }
  }
  if (kept < 20 || kept === triCount) return null;

  // أعد بناء الشبكة من المثلثات المُبقاة (بكل خصائصها)
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name];
    const items = src.itemSize;
    const arr = new src.array.constructor(kept * 3 * items);
    let w = 0;
    for (let t = 0; t < triCount; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const base = (t * 3 + k) * items;
        for (let ci = 0; ci < items; ci++) arr[w++] = src.array[base + ci];
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, items));
  }
  out.computeVertexNormals();
  return out;
}
