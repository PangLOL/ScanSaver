// Mesh helpers for an indexed triangle mesh: { positions: Float32Array, indices: Uint32Array }.

export function faceCount(mesh) {
  return (mesh.indices.length / 3) | 0;
}

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

export function diagonal(bounds) {
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return Math.hypot(dx, dy, dz) || 1;
}

function vertexKey(x, y, z, tmp, bits) {
  tmp[0] = x;
  tmp[1] = y;
  tmp[2] = z;
  return bits[0].toString(16) + ":" + bits[1].toString(16) + ":" + bits[2].toString(16);
}

export function weldMesh(mesh) {
  const src = mesh.positions;
  const count = (src.length / 3) | 0;
  const tmp = new Float32Array(3);
  const bits = new Uint32Array(tmp.buffer);
  const map = new Map();
  const remap = new Uint32Array(count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const key = vertexKey(src[i * 3], src[i * 3 + 1], src[i * 3 + 2], tmp, bits);
    let id = map.get(key);
    if (id === undefined) {
      id = (out.length / 3) | 0;
      map.set(key, id);
      out.push(tmp[0], tmp[1], tmp[2]);
    }
    remap[i] = id;
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i];
    if (v >= count) throw new Error("The mesh indexes a vertex that does not exist.");
    indices[i] = remap[v];
  }
  return { positions: Float32Array.from(out), indices };
}

function permutationSign(a, b, c) {
  const arr = [a, b, c];
  let swaps = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        const swap = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = swap;
        swaps++;
      }
    }
  }
  return swaps % 2 === 0 ? 1 : -1;
}

function crossLength2(positions, a, b, c) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3] - ax;
  const by = positions[b * 3 + 1] - ay;
  const bz = positions[b * 3 + 2] - az;
  const cx = positions[c * 3] - ax;
  const cy = positions[c * 3 + 1] - ay;
  const cz = positions[c * 3 + 2] - az;
  const nx = by * cz - bz * cy;
  const ny = bz * cx - bx * cz;
  const nz = bx * cy - by * cx;
  return nx * nx + ny * ny + nz * nz;
}

export function cleanMesh(mesh) {
  const { positions } = mesh;
  const indices = mesh.indices;
  const bounds = boundsOf(positions);
  const minCross2 = diagonal(bounds) ** 2 * 1e-16;
  const kept = [];
  const seen = new Map();
  const dead = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (a === b || b === c || c === a) continue;
    if (crossLength2(positions, a, b, c) <= minCross2) continue;
    const sorted = [a, b, c].sort((p, q) => p - q);
    const key = sorted[0] + ":" + sorted[1] + ":" + sorted[2];
    const wind = permutationSign(a, b, c);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { slot: kept.length / 3, wind });
      kept.push(a, b, c);
      dead.push(false);
    } else if (prev.slot >= 0 && prev.wind !== wind) {
      dead[prev.slot] = true;
      prev.slot = -1;
    }
  }
  const next = [];
  for (let t = 0; t < dead.length; t++) {
    if (dead[t]) continue;
    next.push(kept[t * 3], kept[t * 3 + 1], kept[t * 3 + 2]);
  }
  return compactMesh({ positions, indices: Uint32Array.from(next) });
}

export function compactMesh(mesh) {
  const { positions, indices } = mesh;
  const count = (positions.length / 3) | 0;
  const used = new Uint32Array(count);
  used.fill(0xffffffff);
  let unique = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (used[v] === 0xffffffff) used[v] = unique++;
  }
  const next = new Float32Array(unique * 3);
  for (let v = 0; v < count; v++) {
    if (used[v] === 0xffffffff) continue;
    const d = used[v] * 3;
    const s = v * 3;
    next[d] = positions[s];
    next[d + 1] = positions[s + 1];
    next[d + 2] = positions[s + 2];
  }
  const remapped = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) remapped[i] = used[indices[i]];
  return { positions: next, indices: remapped };
}

export function edgeCensus(indices) {
  const map = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo + ":" + hi;
      const rec = map.get(key);
      if (rec) rec.count++;
      else map.set(key, { count: 1, from: a, to: b });
    }
  }
  const directed = [];
  let openEdges = 0;
  let nonManifold = 0;
  for (const rec of map.values()) {
    if (rec.count === 1) {
      openEdges++;
      directed.push(rec.from, rec.to);
    } else if (rec.count > 2) nonManifold++;
  }
  return { directed, openEdges, nonManifold };
}

export function traceLoops(directed) {
  const next = new Map();
  for (let i = 0; i < directed.length; i += 2) {
    const a = directed[i];
    const b = directed[i + 1];
    let outs = next.get(a);
    if (!outs) {
      outs = [];
      next.set(a, outs);
    }
    outs.push(b);
  }
  const used = new Set();
  const closed = [];
  let unclosed = 0;
  for (let i = 0; i < directed.length; i += 2) {
    const a = directed[i];
    const b = directed[i + 1];
    const first = a + ":" + b;
    if (used.has(first)) continue;
    const loop = [a];
    used.add(first);
    let curr = b;
    let guard = directed.length;
    while (curr !== a && guard-- > 0) {
      loop.push(curr);
      const outs = next.get(curr);
      let nxt = undefined;
      if (outs) {
        for (const cand of outs) {
          const id = curr + ":" + cand;
          if (!used.has(id)) {
            nxt = cand;
            used.add(id);
            break;
          }
        }
      }
      if (nxt === undefined) break;
      curr = nxt;
    }
    if (curr === a && loop.length >= 3) closed.push(loop);
    else unclosed++;
  }
  return { closed, unclosed };
}

function faceVerts(indices, face, flipped) {
  const i = face * 3;
  const a = indices[i];
  const b = indices[i + 1];
  const c = indices[i + 2];
  return flipped ? [a, c, b] : [a, b, c];
}

function edgeKey(a, b) {
  return a < b ? a + ":" + b : b + ":" + a;
}

// Make neighboring faces agree, then turn each shell so it faces away from the table.
export function orientScan(positions, indices, axis, direction) {
  const faces = (indices.length / 3) | 0;
  const adj = new Map();
  for (let f = 0; f < faces; f++) {
    const i = f * 3;
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = edgeKey(a, b);
      let bucket = adj.get(key);
      if (!bucket) {
        bucket = [];
        adj.set(key, bucket);
      }
      bucket.push({ face: f, from: a, to: b });
    }
  }

  const flip = new Uint8Array(faces);
  const seen = new Uint8Array(faces);
  const comp = new Int32Array(faces);
  const queue = new Int32Array(faces);
  let compCount = 0;

  for (let seed = 0; seed < faces; seed++) {
    if (seen[seed]) continue;
    const id = compCount++;
    let qh = 0;
    let qt = 0;
    queue[qt++] = seed;
    seen[seed] = 1;
    comp[seed] = id;
    while (qh < qt) {
      const f = queue[qh++];
      const verts = faceVerts(indices, f, flip[f]);
      const edges = [
        [verts[0], verts[1]],
        [verts[1], verts[2]],
        [verts[2], verts[0]],
      ];
      for (const [u, w] of edges) {
        const bucket = adj.get(edgeKey(u, w));
        if (!bucket || bucket.length !== 2) continue;
        for (const other of bucket) {
          if (other.face === f || seen[other.face]) continue;
          const agrees = other.from === w && other.to === u;
          flip[other.face] = agrees ? 0 : 1;
          seen[other.face] = 1;
          comp[other.face] = id;
          queue[qt++] = other.face;
        }
      }
    }
  }

  const vote = new Float64Array(compCount);
  const up = direction < 0 ? 1 : -1;
  for (let f = 0; f < faces; f++) {
    const [a, b, c] = faceVerts(indices, f, flip[f]);
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax;
    const by = positions[b * 3 + 1] - ay;
    const bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax;
    const cy = positions[c * 3 + 1] - ay;
    const cz = positions[c * 3 + 2] - az;
    const n = [by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx];
    vote[comp[f]] += n[axis] * up;
  }

  const out = new Uint32Array(indices.length);
  for (let f = 0; f < faces; f++) {
    const invert = vote[comp[f]] < 0;
    const [a, b, c] = faceVerts(indices, f, flip[f] ^ (invert ? 1 : 0));
    const i = f * 3;
    out[i] = a;
    out[i + 1] = b;
    out[i + 2] = c;
  }
  return out;
}

export function signedVolume(positions, indices) {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const bx = positions[b];
    const by = positions[b + 1];
    const bz = positions[b + 2];
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function flipIndices(indices) {
  const out = indices.slice();
  for (let i = 0; i < out.length; i += 3) {
    const swap = out[i + 1];
    out[i + 1] = out[i + 2];
    out[i + 2] = swap;
  }
  return out;
}

export function prepareScan(mesh, axis, direction) {
  const welded = cleanMesh(weldMesh(mesh));
  if (welded.indices.length < 3) throw new Error("This file has no triangles.");
  const indices = orientScan(welded.positions, welded.indices, axis, direction);
  return { positions: welded.positions, indices };
}

export function boundarySegments(mesh, limit = 120000) {
  const census = edgeCensus(mesh.indices);
  const pairs = census.directed.length / 2;
  const stride = Math.max(1, Math.ceil(pairs / limit));
  const kept = Math.ceil(pairs / stride);
  const out = new Float32Array(kept * 6);
  const pos = mesh.positions;
  let w = 0;
  for (let i = 0; i < census.directed.length; i += 2 * stride) {
    const a = census.directed[i] * 3;
    const b = census.directed[i + 1] * 3;
    out[w++] = pos[a];
    out[w++] = pos[a + 1];
    out[w++] = pos[a + 2];
    out[w++] = pos[b];
    out[w++] = pos[b + 1];
    out[w++] = pos[b + 2];
  }
  return { segments: out.subarray(0, w), openEdges: census.openEdges, shown: w / 6 };
}
