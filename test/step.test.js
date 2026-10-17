import assert from "node:assert/strict";
import test from "node:test";
import { cadSolid } from "../src/cad.js";
import { formMesh } from "../src/form.js";
import { faceCount } from "../src/mesh.js";
import { writeSTEP } from "../src/step.js";

function slope() {
  return formMesh({
    positions: Float32Array.from([0, 0, 0, 2, 0, 1, 0, 2, 1]),
    indices: Uint32Array.from([0, 1, 2]),
  });
}

function orientedUses(text) {
  const uses = new Map();
  const pattern = /ORIENTED_EDGE\('',\*,\*,#(\d+),\.(T|F)\.\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const id = match[1];
    const sense = match[2];
    if (!uses.has(id)) uses.set(id, []);
    uses.get(id).push(sense);
  }
  return uses;
}

test("STEP is one closed solid and every edge is shared by two faces", () => {
  const formed = slope();
  const text = writeSTEP(formed.mesh, { name: "slope", unit: "mm", date: "2026-10-16T00:00:00" });
  assert.equal(text.includes("MANIFOLD_SOLID_BREP("), true);
  assert.equal(text.includes("CLOSED_SHELL("), true);
  assert.equal(text.includes("AUTOMOTIVE_DESIGN"), true);
  assert.equal(text.includes(".MILLI."), true);
  assert.equal((text.match(/ADVANCED_FACE\(/g) || []).length, formed.triangles);
  const uses = orientedUses(text);
  assert.equal(uses.size, (text.match(/EDGE_CURVE\(/g) || []).length);
  for (const senses of uses.values()) {
    assert.deepEqual(senses.slice().sort(), ["F", "T"]);
  }
  assert.match(text, /CARTESIAN_POINT\('',\(0\.,0\.,0\.\)\)/);
  assert.match(text, /CARTESIAN_POINT\('',\(2\.,0\.,0\.\)\)/);
});

test("inches are labeled without rescaling the coordinates", () => {
  const formed = slope();
  const text = writeSTEP(formed.mesh, { name: "slope", unit: "in" });
  assert.match(text, /CONVERSION_BASED_UNIT\('INCH'/);
  assert.match(text, /25\.4/);
  assert.match(text, /CARTESIAN_POINT\('',\(2\.,0\.,1\.\)\)/);
});

test("a dense patch is reduced to a CAD face budget and stays closed", async () => {
  const n = 24;
  const positions = [];
  const indices = [];
  const id = (i, j) => i * n + j;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i;
      const y = j;
      const z = 4 + Math.sin(i * 0.45) * Math.cos(j * 0.35) + (i === n - 1 && j === n - 1 ? -3 : 0);
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      indices.push(id(i, j), id(i + 1, j), id(i, j + 1));
      indices.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
  }
  const formed = formMesh({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) });
  assert.equal(formed.watertight, true);
  const solid = await cadSolid(formed.mesh, { targetFaces: 80, axis: 2, direction: -1 });
  assert.equal(solid.watertight, true);
  assert.ok(solid.faces <= 120);
  assert.ok(solid.faces < faceCount(formed.mesh));
  const text = writeSTEP(solid.mesh, { name: "patch", unit: "mm" });
  assert.equal((text.match(/ADVANCED_FACE\(/g) || []).length, solid.faces);
});
