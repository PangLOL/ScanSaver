import assert from "node:assert/strict";
import test from "node:test";
import { formMesh } from "../src/form.js";
import { parseMesh, parseOBJ, parsePLY, parseSTL, writeSTL } from "../src/io.js";
import { faceCount } from "../src/mesh.js";

test("binary STL round-trips and still forms", () => {
  const mesh = {
    positions: Float32Array.from([0, 0, 0, 2, 0, 1, 0, 2, 1]),
    indices: Uint32Array.from([0, 1, 2]),
  };
  const parsed = parseSTL(new Uint8Array(writeSTL(mesh, "slope")));
  assert.equal(faceCount(parsed), 1);
  const result = formMesh(parsed);
  assert.equal(result.watertight, true);
  assert.ok(Math.abs(result.volume - 4 / 3) < 1e-4);
});

test("ASCII STL and OBJ parse a triangle", () => {
  const stl = parseSTL(new TextEncoder().encode(`solid t
    facet normal 0 0 1
      outer loop
        vertex 0 0 0
        vertex 1 0 0
        vertex 0 1 1
      endloop
    endfacet
  endsolid t`));
  assert.equal(faceCount(stl), 1);
  const obj = parseOBJ("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n");
  assert.equal(faceCount(obj), 2);
});

test("ASCII and binary PLY parse a quad", () => {
  const ascii = parsePLY(new TextEncoder().encode(`ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
1 1 0
0 1 0
4 0 1 2 3
`));
  assert.equal(faceCount(ascii), 2);

  const payload = new ArrayBuffer(4 * 12 + 1 + 16);
  const view = new DataView(payload);
  const coords = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  coords.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let offset = 48;
  view.setUint8(offset, 4);
  offset += 1;
  [0, 1, 2, 3].forEach((index) => {
    view.setInt32(offset, index, true);
    offset += 4;
  });
  const header = new TextEncoder().encode(`ply
format binary_little_endian 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
`);
  const bytes = new Uint8Array(header.length + payload.byteLength);
  bytes.set(header, 0);
  bytes.set(new Uint8Array(payload), header.length);
  const binary = parseMesh(bytes, "ply");
  assert.equal(faceCount(binary), 2);
});
