import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const workerSource = SCAN_SAVER_WORKER_SOURCE;

const fileInput = document.querySelector("#file");
const openBtn = document.querySelector("#openBtn");
const sampleBtn = document.querySelector("#sampleBtn");
const fileName = document.querySelector("#fileName");
const formBtn = document.querySelector("#formBtn");
const formNote = document.querySelector("#formNote");
const flipBtn = document.querySelector("#flipBtn");
const baseReadout = document.querySelector("#baseReadout");
const hint = document.querySelector("#hint");
const legend = document.querySelector("#legend");
const progress = document.querySelector("#progress");
const progressLabel = document.querySelector("#progressLabel");
const banner = document.querySelector("#banner");
const statTris = document.querySelector("#statTris");
const statOpen = document.querySelector("#statOpen");
const statState = document.querySelector("#statState");
const stlBtn = document.querySelector("#stlBtn");
const stepBtn = document.querySelector("#stepBtn");
const faceSlider = document.querySelector("#faces");
const faceOut = document.querySelector("#faceOut");
const unitSelect = document.querySelector("#unit");
const viewToggle = document.querySelector("#viewToggle");
const stage = document.querySelector("#stage");
const canvas = document.querySelector("#view");

let axis = 2;
let direction = -1;
let bounds = null;
let scanView = null;
let solidView = null;
let showing = "scan";
let busy = false;
let sourceKeep = null;
let formedOptions = null;
let worker = null;
let job = 0;
const pending = new Map();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x141311, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xfff6ea, 0x2c261f, 0.92));
const key = new THREE.DirectionalLight(0xfff3e4, 1.35);
key.position.set(90, -140, 180);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc5d4e6, 0.42);
fill.position.set(-150, 110, 50);
scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.2));

const scanMat = new THREE.MeshStandardMaterial({
  color: 0xd8d0c3,
  roughness: 0.74,
  metalness: 0.02,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const solidMat = new THREE.MeshStandardMaterial({
  color: 0xefd3b4,
  roughness: 0.56,
  metalness: 0.04,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const lineMat = new THREE.LineBasicMaterial({ color: 0xff7a3c });
const bedMat = new THREE.MeshBasicMaterial({
  color: 0xc6531a,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const gridMat = new THREE.LineBasicMaterial({ color: 0xe08a52, transparent: true, opacity: 0.28 });

let body = null;
let lines = null;
let bed = null;

function bootWorker() {
  if (worker) worker.terminate();
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "progress") {
      if (msg.id === job) progressLabel.textContent = msg.label;
      return;
    }
    const ticket = pending.get(msg.id);
    if (!ticket) return;
    pending.delete(msg.id);
    if (msg.type === "error") ticket.reject(new Error(msg.message));
    else ticket.resolve(msg);
  };
  worker.onerror = () => {
    pending.forEach((ticket) => ticket.reject(new Error("The mesh worker stopped.")));
    pending.clear();
  };
}

function request(message, transfer) {
  const id = ++job;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer || []);
  });
}

function cancelJobs() {
  job++;
  pending.forEach((ticket) => ticket.reject(new Error("Cancelled")));
  pending.clear();
  bootWorker();
}

function resize() {
  const width = stage.clientWidth || 1;
  const height = stage.clientHeight || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frame(box, upAxis) {
  const center = new THREE.Vector3(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  const size = new THREE.Vector3(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const radius = Math.max(size.length() * 0.5, 1);
  const up = new THREE.Vector3().setComponent(upAxis, 1);
  const side = new THREE.Vector3().setComponent(upAxis === 0 ? 1 : 0, 1);
  const third = new THREE.Vector3().crossVectors(up, side);
  const eye = up.clone().multiplyScalar(0.9).add(side).add(third.multiplyScalar(0.7)).normalize().multiplyScalar(radius * 2.7);
  camera.up.copy(up);
  camera.position.copy(center).add(eye);
  camera.near = Math.max(radius / 200, 0.001);
  camera.far = radius * 80;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function replaceBody(positions, indices, solid) {
  if (body) {
    scene.remove(body);
    body.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  body = new THREE.Mesh(geometry, solid ? solidMat : scanMat);
  scene.add(body);
}

function setLines(segments) {
  if (lines) {
    scene.remove(lines);
    lines.geometry.dispose();
    lines = null;
  }
  if (!segments || segments.length < 6) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(segments.slice(), 3));
  lines = new THREE.LineSegments(geometry, lineMat);
  lines.renderOrder = 2;
  scene.add(lines);
}

function setBed(upAxis, base, box, fall) {
  if (bed) {
    bed.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    scene.remove(bed);
  }
  bed = new THREE.Group();
  const axes = [0, 1, 2].filter((item) => item !== upAxis);
  const spanU = Math.max(box.max[axes[0]] - box.min[axes[0]], 1);
  const spanV = Math.max(box.max[axes[1]] - box.min[axes[1]], 1);
  const width = spanU * 1.28;
  const height = spanV * 1.28;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), bedMat);
  const normal = new THREE.Vector3().setComponent(upAxis, 1);
  const tangent = new THREE.Vector3().setComponent(axes[0], 1);
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, bitangent, normal));
  const center = new THREE.Vector3(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  center.setComponent(upAxis, base);
  center.addScaledVector(normal, fall * Math.max(spanU, spanV) * 0.004);
  mesh.position.copy(center);
  bed.add(mesh);

  const pts = [];
  const divisions = 8;
  for (let i = 0; i <= divisions; i++) {
    const t = -0.5 + i / divisions;
    pts.push(-width / 2, t * height, 0, width / 2, t * height, 0);
    pts.push(t * width, -height / 2, 0, t * width, height / 2, 0);
  }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)), gridMat);
  grid.quaternion.copy(mesh.quaternion);
  grid.position.copy(mesh.position);
  bed.add(grid);
  scene.add(bed);
}

function animateFall(base, upAxis) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !lines) return Promise.resolve();
  const start = lines.geometry.attributes.position.array.slice();
  const begun = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const t = Math.min(1, (now - begun) / 700);
      const eased = 1 - (1 - t) ** 3;
      const attr = lines.geometry.attributes.position;
      const arr = attr.array;
      for (let i = 0; i < start.length; i += 3) {
        arr[i] = start[i];
        arr[i + 1] = start[i + 1];
        arr[i + 2] = start[i + 2];
        arr[i + upAxis] = start[i + upAxis] + (base - start[i + upAxis]) * eased;
      }
      attr.needsUpdate = true;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function formatLength(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function currentBase(box = bounds) {
  if (!box) return null;
  return direction < 0 ? box.min[axis] : box.max[axis];
}

function refreshReadout() {
  const base = currentBase();
  const way = direction < 0 ? "lowest" : "highest";
  baseReadout.textContent = base === null ? "Base waits for a scan." : `${way} ${"XYZ"[axis]} = ${formatLength(base)}`;
  const dirty = solidView && formedOptions && (formedOptions.axis !== axis || formedOptions.direction !== direction);
  formBtn.classList.toggle("dirty", Boolean(dirty));
  formNote.textContent = dirty
    ? "Direction changed. Drop edges again to rebuild the solid."
    : "Walls fall straight to the base, then the floor is capped.";
}

function showBanner(text) {
  if (!text) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
}

function setBusy(on, label) {
  busy = on;
  progress.hidden = !on;
  if (label) progressLabel.textContent = label;
  formBtn.textContent = on ? "Cancel" : "Drop edges";
  openBtn.disabled = on;
  sampleBtn.disabled = on;
  stlBtn.disabled = on || !solidView;
  stepBtn.disabled = on || !solidView;
  formBtn.disabled = on ? false : !scanView;
}

function showMesh(view, solid) {
  replaceBody(view.positions, view.indices, solid);
  setLines(solid ? null : view.boundary);
  const box = view.bounds || bounds;
  const upAxis = solid && formedOptions ? formedOptions.axis : axis;
  const fall = solid && formedOptions ? formedOptions.direction : direction;
  const base = solid && formedOptions ? formedOptions.base : currentBase(box);
  if (box && base !== null) setBed(upAxis, base, box, fall);
  hint.hidden = true;
  legend.hidden = false;
}

function applyLoaded(result) {
  bounds = result.bounds;
  scanView = result;
  solidView = null;
  formedOptions = null;
  showing = "scan";
  fileName.textContent = result.name;
  statTris.textContent = formatCount(result.triangles);
  statOpen.textContent = formatCount(result.openEdges);
  statState.textContent = result.openEdges === 0 ? "Already closed" : "Open scan";
  statState.className = result.openEdges === 0 ? "state-ok" : "state-warn";
  viewToggle.hidden = true;
  showBanner("");
  showMesh(scanView, false);
  frame(bounds, axis);
  refreshReadout();
  setBusy(false);
}

function render() {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

bootWorker();
resize();
camera.position.set(120, -140, 90);
controls.target.set(0, 0, 20);
controls.update();
requestAnimationFrame(render);
new ResizeObserver(resize).observe(stage);

document.querySelectorAll("#axisSeg button").forEach((button) => {
  button.addEventListener("click", () => {
    axis = Number(button.dataset.axis);
    document.querySelectorAll("#axisSeg button").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
    refreshReadout();
    if (showing === "scan" && bounds) {
      setBed(axis, currentBase(), bounds, direction);
      frame(bounds, axis);
    }
  });
});

flipBtn.addEventListener("click", () => {
  direction = direction < 0 ? 1 : -1;
  flipBtn.setAttribute("aria-pressed", direction > 0 ? "true" : "false");
  flipBtn.textContent = direction > 0 ? "Flipped" : "Flip";
  refreshReadout();
  if (showing === "scan" && bounds) setBed(axis, currentBase(), bounds, direction);
});

faceSlider.addEventListener("input", () => {
  faceOut.textContent = formatCount(faceSlider.value);
});

viewToggle.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !scanView || !solidView) return;
  showing = button.dataset.view;
  viewToggle.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
  const solid = showing === "solid";
  showMesh(solid ? solidView : scanView, solid);
  const view = solid ? solidView : scanView;
  statTris.textContent = formatCount(view.triangles);
  statOpen.textContent = formatCount(view.openEdges);
  statState.textContent = solid ? (solidView.watertight ? "Closed solid" : "Still open") : view.openEdges === 0 ? "Already closed" : "Open scan";
  statState.className = (solid ? solidView.watertight : view.openEdges === 0) ? "state-ok" : "state-warn";
});

openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) readFile(file);
  fileInput.value = "";
});

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) readFile(file);
});

function readFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["stl", "obj", "ply"].includes(ext)) {
    showBanner("Use an STL, OBJ, or PLY scan.");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    sourceKeep = { kind: "file", buffer: reader.result, name: file.name, ext };
    await loadSource();
  };
  reader.readAsArrayBuffer(file);
}

async function loadSource() {
  setBusy(true, "Reading the scan");
  showBanner("");
  try {
    let result;
    if (sourceKeep.kind === "sample") result = await request({ type: "sample" });
    else {
      const copy = sourceKeep.buffer.slice(0);
      result = await request({ type: "load", buffer: copy, ext: sourceKeep.ext, name: sourceKeep.name }, [copy]);
    }
    applyLoaded(result);
  } catch (error) {
    if (error.message !== "Cancelled") showBanner(error.message);
    setBusy(false);
  }
}

sampleBtn.addEventListener("click", () => {
  sourceKeep = { kind: "sample" };
  loadSource();
});

formBtn.addEventListener("click", async () => {
  if (busy) {
    cancelJobs();
    setBusy(false);
    if (sourceKeep) loadSource();
    return;
  }
  if (!scanView) return;
  setBusy(true, "Dropping open edges");
  showBanner("");
  try {
    const result = await request({ type: "form", axis, direction });
    if (showing === "scan") await animateFall(result.base, result.axis);
    solidView = result;
    formedOptions = { axis: result.axis, direction: result.direction, base: result.base };
    showing = "solid";
    viewToggle.hidden = false;
    viewToggle.querySelector('[data-view="solid"]').setAttribute("aria-pressed", "true");
    viewToggle.querySelector('[data-view="scan"]').setAttribute("aria-pressed", "false");
    statTris.textContent = formatCount(result.triangles);
    statOpen.textContent = formatCount(result.openEdges);
    statState.textContent = result.watertight ? "Closed solid" : "Still open";
    statState.className = result.watertight ? "state-ok" : "state-warn";
    const notes = [];
    if (result.openEdgesBefore === 0) notes.push("The scan was already closed, so no edges were dropped.");
    if (!result.watertight) notes.push("Some edges are still open. Non-manifold junctions in the scan were left alone.");
    else if (result.nonManifold) notes.push("Non-manifold junctions were left as they were. The open rims were dropped.");
    showBanner(notes.join(" "));
    showMesh(solidView, true);
    frame(result.bounds, result.axis);
    refreshReadout();
  } catch (error) {
    if (error.message !== "Cancelled") showBanner(error.message);
  } finally {
    setBusy(false);
  }
});

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

stlBtn.addEventListener("click", async () => {
  setBusy(true, "Writing STL");
  try {
    const result = await request({ type: "stl" });
    downloadBlob(new Blob([result.buffer], { type: "model/stl" }), result.filename);
  } catch (error) {
    if (error.message !== "Cancelled") showBanner(error.message);
  } finally {
    setBusy(false);
  }
});

stepBtn.addEventListener("click", async () => {
  setBusy(true, "Building the CAD solid");
  try {
    const result = await request({
      type: "step",
      targetFaces: Number(faceSlider.value),
      unit: unitSelect.value,
    });
    downloadBlob(new Blob([result.text], { type: "model/step" }), result.filename);
    const state = result.watertight ? "closed solid" : "open shell";
    const extra = result.warnings && result.warnings.length ? " " + result.warnings[0] : "";
    showBanner(`STEP wrote ${formatCount(result.faces)} faces, ${state}.${extra}`);
  } catch (error) {
    if (error.message !== "Cancelled") showBanner(error.message);
  } finally {
    setBusy(false);
  }
});
