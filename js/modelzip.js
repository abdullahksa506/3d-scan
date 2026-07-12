// مساعد مشترك: يفكّ ZIP النموذج، يلقى أول ملف مدعوم، ويرسله للعارض.
import { unzipSync } from '../vendor/fflate/fflate.module.js';

const PRIORITY = ['glb', 'gltf', 'obj', 'stl', 'ply', 'usdz'];

export function openModelFromZip(zipUint8, nameHint = 'model') {
  const files = unzipSync(zipUint8);
  let found = null;
  for (const ext of PRIORITY) {
    const name = Object.keys(files).find(
      f => f.toLowerCase().endsWith('.' + ext) && !f.startsWith('__MACOSX')
    );
    if (name) { found = { ext, data: files[name] }; break; }
  }
  if (!found) throw new Error('لم يتم العثور على ملف نموذج داخل الحزمة');
  window.dispatchEvent(new CustomEvent('import-model-buffer', {
    detail: { buffer: found.data.buffer, filename: `${nameHint}.${found.ext}` },
  }));
}
