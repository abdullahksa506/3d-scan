import { MATERIALS, RESIN_SECONDS_PER_LAYER } from './materials.js';

const LINE_WIDTH = 0.4;        // عرض خط الطارد الشائع (ملم)
const OVERHEAD_FACTOR = 1.15;  // حركة غير طابعة + تباطؤ
const HEATUP_SECONDS = 240;    // تسخين وتحضير

let els = {};
let getStats = null; // دالة ترجع { volumeMM3, areaMM2, dims } أو null

export function initCalc(statsProvider) {
  getStats = statsProvider;
  for (const id of ['calc-tech', 'calc-material', 'material-info', 'fdm-fields', 'resin-fields',
    'calc-infill', 'infill-out', 'calc-walls', 'calc-speed', 'calc-supports', 'resin-layer',
    'calc-price', 'price-unit', 'calc-results', 'calc-empty-note', 'calc-settings-hint',
    'r-material', 'r-weight', 'r-cost', 'r-time']) {
    els[id] = document.getElementById(id);
  }

  els['calc-tech'].addEventListener('change', () => { fillMaterials(); recalc(); });
  els['calc-material'].addEventListener('change', () => { applyMaterialDefaults(); recalc(); });
  for (const id of ['calc-infill', 'calc-walls', 'calc-speed', 'calc-supports', 'resin-layer', 'calc-price']) {
    els[id].addEventListener('input', recalc);
  }
  fillMaterials();
  recalc();
}

function currentTech() { return els['calc-tech'].value; }

function currentMaterial() {
  const list = MATERIALS[currentTech()];
  return list.find(m => m.id === els['calc-material'].value) || list[0];
}

function fillMaterials() {
  const tech = currentTech();
  els['calc-material'].innerHTML = MATERIALS[tech]
    .map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  els['fdm-fields'].hidden = tech !== 'fdm';
  els['resin-fields'].hidden = tech !== 'resin';
  els['price-unit'].textContent = tech === 'fdm' ? 'ريال/كجم' : 'ريال/لتر';
  applyMaterialDefaults();
}

function applyMaterialDefaults() {
  const m = currentMaterial();
  els['calc-price'].value = m.price;
  els['material-info'].innerHTML = currentTech() === 'fdm'
    ? `${m.note}<br>🌡️ فوهة: <bdi>${m.nozzle}</bdi> · سطح: <bdi>${m.bed}</bdi> · كثافة: <bdi>${m.density} g/cm³</bdi>`
    : `${m.note}<br>كثافة: <bdi>${m.density} g/cm³</bdi>`;
}

export function recalc() {
  if (!els['calc-tech']) return;
  els['infill-out'].textContent = `${els['calc-infill'].value}٪`;

  const stats = getStats?.();
  if (!stats) {
    els['calc-results'].hidden = true;
    els['calc-empty-note'].hidden = false;
    els['calc-settings-hint'].textContent = '';
    return;
  }
  els['calc-empty-note'].hidden = true;
  els['calc-results'].hidden = false;

  const m = currentMaterial();
  const price = Number(els['calc-price'].value) || 0;
  const V = stats.volumeMM3;    // ملم³
  const A = stats.areaMM2;      // ملم²

  let matVolumeMM3, seconds, hintParts = [];

  if (currentTech() === 'fdm') {
    const infill = Number(els['calc-infill'].value) / 100;
    const walls = Math.max(1, Number(els['calc-walls'].value) || 2);
    const wallThickness = walls * LINE_WIDTH;
    // تقريب: القشرة = مساحة السطح × سماكة الجدار، والباقي حسب نسبة التعبئة
    const shellV = Math.min(V, A * wallThickness);
    matVolumeMM3 = shellV + Math.max(0, V - shellV) * infill;
    if (els['calc-supports'].checked) matVolumeMM3 *= 1.18;

    const flow = Number(els['calc-speed'].value); // mm³/s
    seconds = (matVolumeMM3 / flow) * OVERHEAD_FACTOR + HEATUP_SECONDS;
    if (els['calc-supports'].checked) seconds *= 1.18;

    hintParts.push(`جدران ${walls} × ${LINE_WIDTH} ملم`, `تعبئة ${Math.round(infill * 100)}٪`);
  } else {
    // ريزن: الجسم يُطبع مصمتًا غالبًا + هدر ودعامات ~15٪
    matVolumeMM3 = V * 1.15;
    const layerH = Number(els['resin-layer'].value);
    const layers = Math.ceil(stats.dims.z / layerH);
    seconds = layers * RESIN_SECONDS_PER_LAYER + 600;
    hintParts.push(`${layers.toLocaleString('ar')} طبقة × ${layerH} ملم`, `يشمل 15٪ هدر ودعامات`);
  }

  const grams = (matVolumeMM3 / 1000) * m.density; // سم³ × كثافة
  let cost;
  if (currentTech() === 'fdm') {
    cost = (grams / 1000) * price;
    const meters = matVolumeMM3 / (Math.PI * 1.75 * 1.75 / 4) / 1000; // فتيل 1.75 ملم
    els['r-material'].textContent = `${fmtNum(matVolumeMM3 / 1000)} سم³ (~${fmtNum(meters)} م فتيل)`;
  } else {
    const liters = matVolumeMM3 / 1e6;
    cost = liters * price;
    els['r-material'].textContent = `${fmtNum(matVolumeMM3 / 1000)} مل ريزن`;
  }

  els['r-weight'].textContent = grams >= 1000 ? `${fmtNum(grams / 1000)} كجم` : `${fmtNum(grams)} جم`;
  els['r-cost'].textContent = `${fmtNum(cost)} ريال`;
  els['r-time'].textContent = fmtTime(seconds);
  els['calc-settings-hint'].textContent = hintParts.join(' · ');
}

function fmtNum(x) {
  return x.toLocaleString('ar-SA', { maximumFractionDigits: x < 10 ? 2 : x < 100 ? 1 : 0 });
}

function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  if (h === 0) return `${min} دقيقة`;
  return `${h} س ${min} د`;
}
