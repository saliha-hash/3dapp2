import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/* ===== Calibration: the only values you may need to edit ===== */
const MODEL = "./verniercaliper.glb";
const BEAM_MM = 300;                    // real length of the whole caliper in mm
const SLIDER = "cube004_2";             // GLB part that carries the moving jaw (lower-case)
const HIDE = ["circle_4", "object_12"]; // GLB parts to hide (lower-case)
const MAX_MM = 100;                     // largest object size accepted

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

/* ===== Helpers ===== */
const v3 = new THREE.Vector3();
const box = o => new THREE.Box3().setFromObject(o);
const inside = (o, root) => { for (; o; o = o.parent) if (o === root) return true; return false; };
const shownMesh = m => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
function eachVertex(list, fn) {
  for (const m of list) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) fn(v3.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld), m);
  }
}

/* ===== Load the caliper and measure the jaws from its real geometry ===== */
let rig, slider, ready = false;
const G = {}; // measured facts, all in model units

new GLTFLoader().load(MODEL, gltf => {
  try { setup(gltf.scene); } catch (e) { console.error(e); say("Setup problem: " + e.message); }
}, undefined, e => { console.error(e); say("Model failed to load. Check the file name verniercaliper.glb."); });

function setup(model) {
  rig = new THREE.Group();
  rig.add(model);
  scene.add(rig);
  rig.updateMatrixWorld(true);

  const meshes = [];
  let seed = null;
  model.traverse(o => {
    const n = o.name.toLowerCase();
    if (o.isMesh) meshes.push(o);
    if (!seed && n === SLIDER) seed = o;
    if (HIDE.includes(n)) o.visible = false;
  });
  if (!seed) throw new Error(`part "${SLIDER}" not found (open the page with ?debug)`);
  const shown = () => meshes.filter(shownMesh);

  const all = new THREE.Box3();
  shown().forEach(m => all.union(box(m)));
  const L = all.max.x - all.min.x, H = all.max.y - all.min.y;

  /* Beam bottom (yb) and jaw tips (yt). */
  let yb = Infinity, yt = Infinity;
  eachVertex(shown(), p => {
    yt = Math.min(yt, p.y);
    if (p.x > all.min.x + 0.75 * L) yb = Math.min(yb, p.y);
  });

  /* Hide any stray flat round disc hanging below the beam (the black circle). */
  const hidden = [], size = new THREE.Vector3(), cen = new THREE.Vector3();
  for (const m of shown()) {
    if (inside(m, seed)) continue;
    const b = box(m);
    b.getSize(size); b.getCenter(cen);
    const d = Math.max(size.x, size.y), r = size.x / size.y;
    if (size.z < 0.5 * Math.min(size.x, size.y) && d > 0.035 * L && d < 0.15 * L &&
        r > 0.6 && r < 1.67 && cen.y < yb - 0.05 * H) { m.visible = false; hidden.push(m.name); }
  }

  /* Moving assembly = the jaw part plus every small part riding inside its length (knob, screws). */
  slider = new THREE.Group();
  rig.add(slider);
  const sb = box(seed), tol = 0.15 * (sb.max.x - sb.min.x), parts = [seed];
  for (const m of shown()) {
    if (inside(m, seed)) continue;
    const b = box(m);
    if (b.min.x > sb.min.x - tol && b.max.x < sb.max.x + tol) parts.push(m);
  }
  parts.forEach(o => slider.attach(o));
  rig.updateMatrixWorld(true);

  /* Inner measuring faces, read from the lower jaw region only. */
  const y0 = yt + 0.15 * (yb - yt), y1 = yt + 0.6 * (yb - yt);
  let xf = -Infinity, xs = Infinity, zl = Infinity, zh = -Infinity, beamEnd = -Infinity, slEnd = -Infinity;
  eachVertex(shown(), (p, m) => {
    const mine = inside(m, slider);
    if (mine) slEnd = Math.max(slEnd, p.x); else beamEnd = Math.max(beamEnd, p.x);
    if (p.y < y0 || p.y > y1) return;
    if (mine) xs = Math.min(xs, p.x);
    else if (p.x < all.min.x + 0.5 * L) { xf = Math.max(xf, p.x); zl = Math.min(zl, p.z); zh = Math.max(zh, p.z); }
  });
  if (!isFinite(xf) || !isFinite(xs)) throw new Error("jaw faces not found (open the page with ?debug)");

  /* Place the whole instrument centred and scaled to the viewer. */
  const fit = new THREE.Box3();
  shown().forEach(m => fit.union(box(m)));
  const S = 6.5 / L, fs = fit.getSize(new THREE.Vector3());
  rig.scale.setScalar(S);
  rig.position.copy(fit.getCenter(new THREE.Vector3())).multiplyScalar(-S);
  rig.updateMatrixWorld(true);

  Object.assign(G, {
    S, L, H, xf, y0, y1, yb, zc: (zl + zh) / 2, g0: xs - xf, mmu: BEAM_MM / L,
    tMax: Math.max(0.1 * L, beamEnd - slEnd - 0.01 * L), W: fs.x * S, Hs: fs.y * S, D: fs.z * S
  });

  ready = true;
  viewFull(true);
  say("Caliper ready. Zoom in on the jaws, or add an object to measure.");

  if (new URLSearchParams(location.search).has("debug")) {
    const pre = document.createElement("pre");
    pre.className = "debug";
    pre.textContent = JSON.stringify({
      meshes: meshes.map(m => m.name), hidden, moving: parts.map(p => p.name),
      G: Object.fromEntries(Object.entries(G).map(([k, x]) => [k, +x.toFixed(4)]))
    }, null, 1);
    document.body.append(pre);
  }
}

/* ===== Camera ===== */
let fly = null;
const dist = span => span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

function go(pos, tgt, instant) {
  if (instant) { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); fly = null; }
  else fly = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: tgt };
}
function viewFull(instant) {
  go(new THREE.Vector3(0, 0, dist(Math.max(G.W / camera.aspect, G.Hs) * 1.15) + G.D / 2), new THREE.Vector3(), instant);
}
function viewJaws() {
  if (!ready) return;
  const gap = G.g0 + slider.position.x;
  const c = new THREE.Vector3(G.xf + gap / 2, (G.y0 + G.y1) / 2, G.zc).multiplyScalar(G.S).add(rig.position);
  const span = Math.max(G.Hs * 0.75, ((gap + 0.2 * G.L) * G.S) / camera.aspect);
  go(new THREE.Vector3(c.x, c.y, c.z + dist(span)), c);
}
$("fitButton").onclick = () => ready && viewFull();
$("jawsButton").onclick = viewJaws;

/* ===== Jaw slider (only while no object is held) ===== */
$("jawSlider").addEventListener("input", () => {
  const val = Number($("jawSlider").value);
  $("jawValue").textContent = val + "%";
  if (ready && !obj) slider.position.x = (val / 100) * G.tMax;
});

/* ===== Objects: jaws always close exactly on the first size ===== */
const SHAPES = {
  sphere:   { f: ["Diameter"],                geo: a => new THREE.SphereGeometry(a / 2, 64, 40),               up: a => a },
  cube:     { f: ["Side"],                    geo: a => new THREE.BoxGeometry(a, a, a),                       up: a => a },
  cylinder: { f: ["Diameter", "Height"],      geo: (a, b) => new THREE.CylinderGeometry(a / 2, a / 2, b, 64), up: (a, b) => b },
  cuboid:   { f: ["Length", "Width", "Height"], geo: (a, b, c) => new THREE.BoxGeometry(a, c, b),             up: (a, b, c) => c },
  cone:     { f: ["Base diameter", "Height"], geo: (a, b) => new THREE.ConeGeometry(a / 2, b, 64),           up: (a, b) => b }
};
let shape = null, obj = null;

function readDims() {
  const d = SHAPES[shape].f.map((_, i) => parseFloat($("dim" + "ABC"[i]).value));
  const maxMM = Math.min(MAX_MM, (G.tMax + G.g0) * G.mmu);
  if (d.some(x => !(x >= 1 && x <= MAX_MM))) return say(`Enter sizes between 1 and ${MAX_MM} mm.`);
  if (d[0] > maxMM) return say(`The jaws open to ${Math.floor(maxMM)} mm at most. Reduce the first size.`);
  return d;
}

function place() {
  if (!obj) return;
  const d = readDims();
  if (!d) return;
  const sh = SHAPES[shape], u = 1 / G.mmu, v = d.map(x => x * u);
  obj.geometry.dispose();
  obj.geometry = sh.geo(...v);
  slider.position.x = v[0] - G.g0;            // jaw faces exactly one object-size apart
  const h = sh.up(...v);
  let y = shape === "cone" ? G.y0 + h / 2 : (G.y0 + G.y1) / 2;
  y = Math.min(y, G.yb - h / 2 - 0.004 * G.L); // never poke into the beam
  obj.position.set(G.xf + v[0] / 2, y, G.zc);  // touching the fixed jaw face
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
  slider.position.x = Math.min(G.tMax, Math.max(0, slider.position.x));
  const pct = Math.round((slider.position.x / G.tMax) * 100);
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
