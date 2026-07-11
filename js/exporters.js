import * as THREE from 'three';
import { zipSync, strToU8 } from '../vendor/fflate/fflate.module.js';
import { mergeByPosition } from './analysis.js';

function triangleIterator(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const getIdx = index ? (t, k) => index.getX(t * 3 + k) : (t, k) => t * 3 + k;
  return { pos, triCount, getIdx };
}

// ---------- STL ثنائي ----------
export function exportSTL(geometry, name = 'model') {
  const { pos, triCount, getIdx } = triangleIterator(geometry);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buffer);
  const header = `Exported by 3D Scan to Print web app`;
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, triCount, true);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, getIdx(t, 0));
    b.fromBufferAttribute(pos, getIdx(t, 1));
    c.fromBufferAttribute(pos, getIdx(t, 2));
    n.copy(t1.copy(b).sub(a)).cross(t2.copy(c).sub(a)).normalize();
    dv.setFloat32(off, n.x, true); dv.setFloat32(off + 4, n.y, true); dv.setFloat32(off + 8, n.z, true);
    off += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true);
      off += 12;
    }
    dv.setUint16(off, 0, true); off += 2;
  }
  downloadBlob(new Blob([buffer], { type: 'model/stl' }), `${name}.stl`);
}

// ---------- OBJ نصي ----------
export function exportOBJ(geometry, name = 'model') {
  const geo = geometry.index ? geometry : mergeByPosition(geometry);
  const pos = geo.attributes.position;
  const index = geo.index;
  const parts = ['# Exported by 3D Scan to Print web app\n'];
  for (let i = 0; i < pos.count; i++) {
    parts.push(`v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}\n`);
  }
  const triCount = index.count / 3;
  for (let t = 0; t < triCount; t++) {
    parts.push(`f ${index.getX(t * 3) + 1} ${index.getX(t * 3 + 1) + 1} ${index.getX(t * 3 + 2) + 1}\n`);
  }
  downloadBlob(new Blob(parts, { type: 'text/plain' }), `${name}.obj`);
}

// ---------- 3MF (ZIP + XML) ----------
export function export3MF(geometry, name = 'model') {
  const geo = geometry.index ? geometry : mergeByPosition(geometry);
  const pos = geo.attributes.position;
  const index = geo.index;

  let verts = '';
  for (let i = 0; i < pos.count; i++) {
    verts += `<vertex x="${fmt(pos.getX(i))}" y="${fmt(pos.getY(i))}" z="${fmt(pos.getZ(i))}"/>`;
  }
  let tris = '';
  const triCount = index.count / 3;
  for (let t = 0; t < triCount; t++) {
    tris += `<triangle v1="${index.getX(t * 3)}" v2="${index.getX(t * 3 + 1)}" v3="${index.getX(t * 3 + 2)}"/>`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ar" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(modelXml),
  }, { level: 6 });

  downloadBlob(new Blob([zipped], { type: 'model/3mf' }), `${name}.3mf`);
}

function fmt(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
