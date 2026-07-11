import * as THREE from 'three';
import { mergeVertices } from '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

// دمج النقاط حسب الموضع فقط — نحذف بقية الخصائص من نسخة مؤقتة
export function mergeByPosition(geometry, tolerance = 1e-4) {
  const tmp = geometry.clone();
  for (const key of Object.keys(tmp.attributes)) {
    if (key !== 'position') tmp.deleteAttribute(key);
  }
  tmp.morphAttributes = {};
  return mergeVertices(tmp, tolerance);
}

// يحسب: أبعاد، حجم، مساحة، مثلثات، حواف مفتوحة/غير سليمة، مغلق أم لا
export function analyzeGeometry(geometry) {
  // ندمج النقاط حسب الموضع فقط (نتجاهل normals/UV) للحصول على طوبولوجيا صحيحة
  const geo = mergeByPosition(geometry);
  const pos = geo.attributes.position;
  const index = geo.index;

  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);

  const triCount = index ? index.count / 3 : pos.count / 3;

  let volume = 0, area = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();

  const edgeCount = new Map();
  const addEdge = (i, j) => {
    // مفتاح رقمي آمن حتى ~16 مليون نقطة
    const key = i < j ? i * 16777216 + j : j * 16777216 + i;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  };

  const getIdx = index
    ? (t, k) => index.getX(t * 3 + k)
    : (t, k) => t * 3 + k;

  for (let t = 0; t < triCount; t++) {
    const i0 = getIdx(t, 0), i1 = getIdx(t, 1), i2 = getIdx(t, 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    // حجم رباعي وجوه بإشارة (نظرية الانحراف)
    volume += a.dot(ab.copy(b).cross(c)) / 6;
    // مساحة المثلث
    ab.copy(b).sub(a);
    ac.copy(c).sub(a);
    area += cr.copy(ab).cross(ac).length() / 2;
    if (index) { addEdge(i0, i1); addEdge(i1, i2); addEdge(i2, i0); }
  }

  let boundaryEdges = 0, nonManifoldEdges = 0;
  if (index) {
    for (const n of edgeCount.values()) {
      if (n === 1) boundaryEdges++;
      else if (n > 2) nonManifoldEdges++;
    }
  }

  const flipped = volume < 0;
  volume = Math.abs(volume);
  const watertight = index ? (boundaryEdges === 0 && nonManifoldEdges === 0) : false;

  return {
    dims: size,               // ملم
    volumeMM3: volume,        // ملم³
    areaMM2: area,            // ملم²
    triCount,
    boundaryEdges,
    nonManifoldEdges,
    watertight,
    flipped,
    indexed: !!index,
  };
}
