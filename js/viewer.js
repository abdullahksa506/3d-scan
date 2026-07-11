import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/examples/jsm/controls/OrbitControls.js';

let renderer, scene, camera, controls, mesh, grid;
let container;

export function initViewer(el) {
  container = el;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x0a0e14);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
  camera.position.set(140, 110, 140);
  camera.up.set(0, 0, 1); // محور Z للأعلى مثل برامج التقطيع

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x202531, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(120, 180, 260);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0x88aaff, 0.4);
  dir2.position.set(-150, -100, 80);
  scene.add(dir2);

  buildPlate(220);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

function buildPlate(size) {
  if (grid) scene.remove(grid);
  grid = new THREE.Group();
  const g = new THREE.GridHelper(size, size / 10, 0x3a4a63, 0x232c3d);
  g.rotation.x = Math.PI / 2; // GridHelper في مستوى XZ — نلفّه ليصبح XY
  grid.add(g);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size)),
    new THREE.LineBasicMaterial({ color: 0x4d9fff })
  );
  grid.add(outline);
  scene.add(grid);
}

export function showGeometry(geometry) {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7fb3ff, metalness: 0.05, roughness: 0.6,
    side: THREE.DoubleSide, flatShading: !geometry.attributes.normal,
  });
  mesh = new THREE.Mesh(geometry, mat);
  scene.add(mesh);
  fitView();
}

export function refresh() {
  if (mesh) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}

export function fitView() {
  if (!mesh) return;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.6;
  const dirVec = new THREE.Vector3(1, -1, 0.7).normalize();
  camera.position.copy(center).addScaledVector(dirVec, dist);
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  // كبّر سطح الطباعة إذا كان النموذج أكبر منه
  const plate = Math.max(220, Math.ceil(Math.max(size.x, size.y) / 100) * 100 + 100);
  buildPlate(plate);
}

export function toggleWireframe() {
  if (!mesh) return false;
  mesh.material.wireframe = !mesh.material.wireframe;
  return mesh.material.wireframe;
}

export function hasMesh() { return !!mesh; }
