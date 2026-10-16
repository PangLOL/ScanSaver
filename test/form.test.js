import assert from "node:assert/strict";
import test from "node:test";
import { formMesh } from "../src/form.js";
import { edgeCensus, faceCount, signedVolume } from "../src/mesh.js";
import { sampleScan } from "../src/sample.js";

function faceSet(indices) {
  const set = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b);
    set.add(tri.join(","));
  }
  return set;
}

function mesh(positions, indices) {
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

test("a raised triangle grows walls down to the lowest point and closes", () => {
  const source = mesh([0, 0, 0, 2, 0, 1, 0, 2, 1], [0, 1, 2]);
  const result = formMesh(source, { axis: 2, direction: -1 });
  assert.equal(result.watertight, true);
  assert.equal(result.base, 0);
  assert.ok(Math.abs(result.volume - 4 / 3) < 1e-4);
  assert.deepEqual(faceSet(result.mesh.indices), new Set(["0,1,2", "0,1,3", "1,2,4", "1,3,4", "0,2,4", "0,3,4"]));
  const z = result.mesh.positions;
  assert.equal(z[3 * 3 + 2], 0);
  assert.equal(z[4 * 3 + 2], 0);
});

test("a flipped scan still closes with the same volume", () => {
  const source = mesh([0, 0, 0, 2, 0, 1, 0, 2, 1], [0, 2, 1]);
  const result = formMesh(source, { axis: 2, direction: -1 });
  assert.equal(result.watertight, true);
  assert.ok(Math.abs(result.volume - 4 / 3) < 1e-4);
});

test("an open pyramid is capped on its base", () => {
  const source = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.25, 0.25, 1], [0, 1, 3, 1, 2, 3, 2, 0, 3]);
  const result = formMesh(source);
  assert.equal(result.watertight, true);
  assert.equal(result.triangles, 4);
  assert.ok(Math.abs(result.volume - 1 / 6) < 1e-4);
});

test("an interior hole falls to the same base as the outer rim", () => {
  const positions = [
    0, 0, 2, 4, 0, 2, 4, 4, 2, 0, 4, 2,
    1.5, 1.5, 2, 2.5, 1.5, 2, 2.5, 2.5, 2, 1.5, 2.5, 2,
    2, -1, 0,
  ];
  const indices = [
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    0, 1, 8,
  ];
  const result = formMesh(mesh(positions, indices));
  assert.equal(result.watertight, true);
  assert.equal(result.base, 0);
  const hit = [];
  for (let i = 0; i < result.mesh.positions.length; i += 3) {
    const x = result.mesh.positions[i];
    const y = result.mesh.positions[i + 1];
    const z = result.mesh.positions[i + 2];
    if (Math.abs(x - 1.5) < 1e-4 && Math.abs(y - 1.5) < 1e-4 && Math.abs(z) < 1e-4) hit.push(i);
  }
  assert.equal(hit.length, 1);
  assert.ok(result.volume > 0);
});

test("flip uses the highest point as the base", () => {
  const source = mesh([0, 0, 0, 1, 0, 0, 0, 1, 1], [0, 1, 2]);
  const result = formMesh(source, { axis: 2, direction: 1 });
  assert.equal(result.watertight, true);
  assert.equal(result.base, 1);
  let above = false;
  for (let i = 2; i < result.mesh.positions.length; i += 3) {
    assert.ok(result.mesh.positions[i] <= 1 + 1e-5);
    if (Math.abs(result.mesh.positions[i] - 1) < 1e-5) above = true;
  }
  assert.equal(above, true);
});

test("the pull can run along X", () => {
  const source = mesh([0, 0, 0, 1, 2, 0, 1, 0, 2], [0, 1, 2]);
  const result = formMesh(source, { axis: 0, direction: -1 });
  assert.equal(result.watertight, true);
  assert.equal(result.base, 0);
  assert.equal(edgeCensus(result.mesh.indices).openEdges, 0);
  assert.ok(faceCount(result.mesh) > 1);
});

test("the sample scan becomes a closed solid", () => {
  const sample = sampleScan();
  const before = faceCount(sample.mesh);
  const result = formMesh(sample.mesh);
  assert.equal(result.watertight, true);
  assert.ok(result.triangles > before);
  assert.ok(result.openEdgesBefore > 0);
  assert.ok(signedVolume(result.mesh.positions, result.mesh.indices) > 0);
});
