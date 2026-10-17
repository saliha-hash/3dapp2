import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/* ===== Calibration, measured from verniercaliper.glb (model units) ===== */
const MODEL = "./verniercaliper.glb";
const MM_PER_UNIT = 31.27;  // from the vernier photo: 1 model unit = 31.27 mm
const ZERO_X = -1.1227;     // x of the vernier zero line when the jaws are closed
const FACE_X = -1.521;      // inner face of both jaws when closed (fixed jaw face)
const FACE_Z = 0.366;       // z where the fixed and moving jaw blades overlap
const ROOT_Y = -0.17;       // just below the beam, where both jaw faces start
const TRAVEL = 3.47;        // how far the moving jaw can slide (units)
const RULER_PX_PER_MM = 2.903; // ruler texture: 35 px = zero, 2.903 px per mm
const MOVING = ["cube004_2", "cylinder_3"];   // slider body and thumb knob
const HIDE = ["circle_4", "cylinder001_5"];   // stray parts (the black circle)

const $ = id => document.getElementById(id);
const say = t => ($("status").textContent = t, null);
const viewer = $("viewer");

/* ===== Scene ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080a);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
viewer.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
[[3.5, 4, 6, 7], [2.5, -5, 3, 4], [2, 0, -3, -5]].forEach(([p, x, y, z]) => {
  const l = new THREE.DirectionalLight(0xffffff, p);
  l.position.set(x, y, z);
  scene.add(l);
});

const silver = new THREE.MeshStandardMaterial({
  color: 0xdfe3e8, metalness: 0.9, roughness: 0.25,
  envMap: new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
});

/* One finger moves, pinch zooms toward the fingers; mouse: drag rotates, right-drag moves. */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.minDistance = 0.3;
controls.maxDistance = 30;
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
let moved = false;
controls.addEventListener("start", () => (moved = true));

/* ===== Load the caliper ===== */
let rig, slider, ready = false, W = 6, H = 2.5;
const v3 = new THREE.Vector3();

new GLTFLoader().load(MODEL, gltf => {
  try { setup(gltf.scene); } catch (e) { console.error(e); say("Setup problem: " + e.message); }
}, undefined, e => { console.error(e); say("Model failed to load. Check the file name verniercaliper.glb."); });

/* The model's ruler is a stock 30 cm image. Re-map it so its zero sits at the vernier zero
   and its millimetres match the vernier scale, so the reading equals the jaw opening. */
function fixRuler(mesh) {
  mesh.updateWorldMatrix(true, false);
  const mw = mesh.matrixWorld, inv = mw.clone().invert();
  const p = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i).applyMatrix4(mw);
    v3.x = Math.max(v3.x, ZERO_X);
    uv.setX(i, (35 + RULER_PX_PER_MM * MM_PER_UNIT * (v3.x - ZERO_X)) / 1024);
    v3.applyMatrix4(inv);
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  p.needsUpdate = uv.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function setup(model) {
  rig = new THREE.Group();
  rig.add(model);
  scene.add(rig);
  rig.updateMatrixWorld(true);

  const parts = [];
  model.traverse(o => {
    const n = o.name.toLowerCase();
    if (HIDE.includes(n)) o.visible = false;
    if (MOVING.includes(n)) parts.push(o);
  });
  if (parts.length < MOVING.length) throw new Error("moving jaw parts not found in the model");
  const ruler = model.getObjectByName("Object_4");
  if (ruler) fixRuler(ruler);

  slider = new THREE.Group();
  rig.add(slider);
  parts.forEach(o => slider.attach(o));

  const fit = new THREE.Box3();
  model.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    fit.union(new THREE.Box3().setFromObject(o));
  });
  const size = fit.getSize(new THREE.Vector3());
  W = size.x; H = size.y;
  rig.position.copy(fit.getCenter(new THREE.Vector3())).negate();
  rig.updateMatrixWorld(true);

  ready = true;
  viewFull(true);
  say("Caliper ready. Zoom in on the jaws, or add an object to measure.");
}

/* ===== Camera ===== */
let fly = null;
const dist = span => span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

function go(pos, tgt, instant) {
  if (instant) { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); fly = null; }
  else fly = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: tgt };
}
function viewFull(instant) {
  go(new THREE.Vector3(0, 0, dist(Math.max(W / camera.aspect, H) * 1.15) + 1), new THREE.Vector3(), instant);
}
function viewJaws() {
  if (!ready) return;
  const gap = slider.position.x;
  const c = rig.localToWorld(new THREE.Vector3(FACE_X + gap / 2, -0.55, FACE_Z));
  go(new THREE.Vector3(c.x, c.y, c.z + dist(Math.max(2.2, (gap + 1.4) / camera.aspect))), c);
}
$("fitButton").onclick = () => ready && viewFull();
$("jawsButton").onclick = viewJaws;

/* ===== Jaw slider (only while no object is held) ===== */
$("jawSlider").addEventListener("input", () => {
  const val = Number($("jawSlider").value);
  $("jawValue").textContent = val + "%";
  if (ready && !obj) slider.position.x = (val / 100) * TRAVEL;
});

/* ===== Objects: the jaws always close exactly on the first size ===== */
const SHAPES = {
  sphere:   { f: ["Diameter"],                  max: 60, geo: a => new THREE.SphereGeometry(a / 2, 64, 40),               h: a => a },
  cube:     { f: ["Side"],                      max: 100, geo: a => new THREE.BoxGeometry(a, a, a),                       h: a => a },
  cylinder: { f: ["Diameter", "Height"],        max: 100, geo: (a, b) => new THREE.CylinderGeometry(a / 2, a / 2, b, 64), h: (a, b) => b },
  cuboid:   { f: ["Length", "Width", "Height"], max: 100, geo: (a, b, c) => new THREE.BoxGeometry(a, c, b),               h: (a, b, c) => c },
  cone:     { f: ["Base diameter", "Height"],   max: 100, geo: (a, b) => new THREE.ConeGeometry(a / 2, b, 64),            h: (a, b) => b }
};
let shape = null, obj = null;

function readDims() {
  const sh = SHAPES[shape];
  const d = sh.f.map((_, i) => parseFloat($("dim" + "ABC"[i]).value));
  const limit = Math.min(sh.max, Math.floor(TRAVEL * MM_PER_UNIT));
  if (d.some(x => !(x >= 1 && x <= sh.max))) return say(`Enter sizes between 1 and ${sh.max} mm.`);
  if (d[0] > limit) return say(`The jaws open to ${limit} mm at most. Reduce the first size.`);
  return d;
}

function place() {
  if (!obj) return;
  const d = readDims();
  if (!d) return;
  const sh = SHAPES[shape], u = 1 / MM_PER_UNIT, v = d.map(x => x * u);
  obj.geometry.dispose();
  obj.geometry = sh.geo(...v);
  slider.position.x = v[0];                   // jaw faces are exactly one object-size apart
  const h = sh.h(...v);
  let top = shape === "cone" ? ROOT_Y - 0.05 : ROOT_Y;   // cone hangs point-down from its base
  let y = top - h / 2;
  if (shape === "sphere") y = Math.max(y, -1.05);       // keep the widest part inside the jaw faces
  obj.rotation.z = shape === "cone" ? Math.PI : 0;
  obj.position.set(FACE_X + v[0] / 2, y, FACE_Z);       // touching the fixed jaw face
  $("measurementAnswer").textContent = sh.f.map((n, i) => `${n}: ${d[i]} mm`).join(",  ");
  say(`Object is held between the jaws. Measured size: ${d[0]} mm.`);
}

function selectShape(s) {
  if (!ready) return say("Wait for the caliper to load.");
  shape = s;
  if (!obj) { obj = new THREE.Mesh(new THREE.BufferGeometry(), silver); rig.add(obj); }
  document.querySelectorAll("[data-shape]").forEach(b => b.classList.toggle("active", b.dataset.shape === s));
  "ABC".split("").forEach((k, i) => {
    const on = i < SHAPES[s].f.length;
    $("field" + k).hidden = !on;
    if (on) $("label" + k).textContent = SHAPES[s].f[i] + " (mm)";
  });
  $("objectPanel").hidden = false;
  $("jawControlPanel").hidden = true;
  place();
}

function removeObject() {
  if (!obj) return;
  rig.remove(obj);
  obj.geometry.dispose();
  obj = shape = null;
  document.querySelectorAll("[data-shape]").forEach(b => b.classList.remove("active"));
  $("objectPanel").hidden = true;
  $("jawControlPanel").hidden = false;
  slider.position.x = Math.min(TRAVEL, Math.max(0, slider.position.x));
  const pct = Math.round((slider.position.x / TRAVEL) * 100);
  $("jawSlider").value = pct;
  $("jawValue").textContent = pct + "%";
  say("Object removed. Move the jaws freely.");
}

document.querySelectorAll("[data-shape]").forEach(b => (b.onclick = () => selectShape(b.dataset.shape)));
["dimA", "dimB", "dimC"].forEach(id => $(id).addEventListener("input", place));
$("removeButton").onclick = removeObject;

/* ===== Resize and render ===== */
new ResizeObserver(() => {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (ready && !moved) viewFull(true);
}).observe(viewer);

(function animate(now) {
  requestAnimationFrame(animate);
  if (fly) {
    const k = Math.min(1, (now - fly.t0) / 500), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.q0, fly.q1, e);
    if (k === 1) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
})(performance.now());
