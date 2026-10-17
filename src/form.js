import cdt2d from "cdt2d";
import {
  boundsOf,
  cleanMesh,
  diagonal,
  edgeCensus,
  flipIndices,
  prepareScan,
  signedVolume,
  traceLoops,
} from "./mesh.js";

const UV = [
  [1, 2],
  [2, 0],
  [0, 1],
];

function area2(pos, a, b, c) {
  const ax = pos[a * 3];
  const ay = pos[a * 3 + 1];
  const az = pos[a * 3 + 2];
  const bx = pos[b * 3] - ax;
  const by = pos[b * 3 + 1] - ay;
  const bz = pos[b * 3 + 2] - az;
  const cx = pos[c * 3] - ax;
  const cy = pos[c * 3 + 1] - ay;
  const cz = pos[c * 3 + 2] - az;
  const nx = by * cz - bz * cy;
  const ny = bz * cx - bx * cz;
  const nz = bx * cy - by * cx;
  return nx * nx + ny * ny + nz * nz;
}

function signedArea(positions, loop, u, v) {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    const xi = positions[loop[i] * 3 + u];
    const yi = positions[loop[i] * 3 + v];
    const xj = positions[loop[j] * 3 + u];
    const yj = positions[loop[j] * 3 + v];
    sum += xi * yj - xj * yi;
  }
  return sum * 0.5;
}

function pointInLoop(px, py, loop, positions, u, v) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = positions[loop[i] * 3 + u];
    const yi = positions[loop[i] * 3 + v];
    const xj = positions[loop[j] * 3 + u];
    const yj = positions[loop[j] * 3 + v];
    const hit = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function dedupeLoop(loop) {
  const out = [];
  for (const v of loop) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function loopExtent(positions, loop, u, v) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const vi of loop) {
    const x = positions[vi * 3 + u];
    const y = positions[vi * 3 + v];
    if (x < minU) minU = x;
    if (x > maxU) maxU = x;
    if (y < minV) minV = y;
    if (y > maxV) maxV = y;
  }
  return (maxU - minU) * (maxV - minV);
}

function interiorPoint(loop, positions, u, v) {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    const dx = positions[loop[j] * 3 + u] - positions[loop[i] * 3 + u];
    const dy = positions[loop[j] * 3 + v] - positions[loop[i] * 3 + v];
    const len2 = dx * dx + dy * dy;
    if (len2 > bestLen) {
      bestLen = len2;
      best = i;
    }
  }
  const i = best;
  const j = (i + 1) % loop.length;
  const x1 = positions[loop[i] * 3 + u];
  const y1 = positions[loop[i] * 3 + v];
  const x2 = positions[loop[j] * 3 + u];
  const y2 = positions[loop[j] * 3 + v];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const side = signedArea(positions, loop, u, v) >= 0 ? 1 : -1;
  const nudge = len * 1e-3;
  return [(x1 + x2) / 2 + (-dy / len) * nudge * side, (y1 + y2) / 2 + (dx / len) * nudge * side];
}

// Drop every open boundary to the lowest (or highest) point on an axis and cap the base.
export function formMesh(mesh, options = {}) {
  const axis = options.axis ?? 2;
  const direction = (options.direction ?? -1) >= 0 ? 1 : -1;
  if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error("Axis must be X, Y, or Z.");

  const prepared = prepareScan(mesh, axis, direction);
  const before = edgeCensus(prepared.indices);
  const bounds = boundsOf(prepared.positions);
  let base = direction < 0 ? Infinity : -Infinity;
  const count0 = (prepared.positions.length / 3) | 0;
  for (let i = 0; i < count0; i++) {
    const v = prepared.positions[i * 3 + axis];
    base = direction < 0 ? Math.min(base, v) : Math.max(base, v);
  }
  const span = Math.max(Math.abs(bounds.max[axis] - bounds.min[axis]), Math.abs(base), 1);
  const eps = Math.max(span * 1e-6, 1e-7);
  const minCross2 = diagonal(bounds) ** 2 * 1e-16;

  const loops = traceLoops(before.directed);
  let pos = new Float32Array((count0 + before.openEdges + 8) * 3);
  pos.set(prepared.positions);
  let vertCount = count0;

  const tmp = new Float32Array(3);
  const bits = new Uint32Array(tmp.buffer);
  const keyToIndex = new Map();
  const keyFrom = (x, y, z) => {
    tmp[0] = x;
    tmp[1] = y;
    tmp[2] = z;
    return bits[0].toString(16) + ":" + bits[1].toString(16) + ":" + bits[2].toString(16);
  };
  for (let i = 0; i < vertCount; i++) {
    const key = keyFrom(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    if (!keyToIndex.has(key)) keyToIndex.set(key, i);
  }

  const proj = new Int32Array(count0);
  proj.fill(-1);

  function addVertex(x, y, z) {
    if ((vertCount + 1) * 3 > pos.length) {
      const grown = new Float32Array(pos.length * 2);
      grown.set(pos.subarray(0, vertCount * 3));
      pos = grown;
    }
    const o = vertCount * 3;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    const id = vertCount++;
    keyToIndex.set(keyFrom(pos[o], pos[o + 1], pos[o + 2]), id);
    return id;
  }

  function projectionOf(i) {
    if (proj[i] >= 0) return proj[i];
    const o = i * 3;
    if (Math.abs(pos[o + axis] - base) <= eps) {
      proj[i] = i;
      return i;
    }
    const q = [pos[o], pos[o + 1], pos[o + 2]];
    q[axis] = base;
    const key = keyFrom(q[0], q[1], q[2]);
    let idx = keyToIndex.get(key);
    if (idx === undefined) idx = addVertex(q[0], q[1], q[2]);
    proj[i] = idx;
    return idx;
  }

  const wall = [];
  function pushTri(a, b, c) {
    if (a === b || b === c || c === a) return;
    if (area2(pos, a, b, c) <= minCross2) return;
    wall.push(a, b, c);
  }

  for (let i = 0; i < before.directed.length; i += 2) {
    const a = before.directed[i];
    const b = before.directed[i + 1];
    const a2 = projectionOf(a);
    const b2 = projectionOf(b);
    const aOn = a2 === a;
    const bOn = b2 === b;
    if (aOn && bOn) continue;
    if (aOn) pushTri(a, b2, b);
    else if (bOn) pushTri(a, a2, b);
    else {
      pushTri(a, b2, b);
      pushTri(a, a2, b2);
    }
  }

  const [u, v] = UV[axis];
  const floor = [];
  const projectedLoops = [];
  let uncapped = 0;
  for (const loop of loops.closed) {
    const mapped = dedupeLoop(loop.map((vi) => projectionOf(vi)));
    if (mapped.length < 3) continue;
    const area = Math.abs(signedArea(pos, mapped, u, v));
    if (area > eps * eps) projectedLoops.push(mapped);
    else if (loopExtent(pos, mapped, u, v) > eps * eps) uncapped++;
  }

  const nodes = projectedLoops
    .map((loop) => ({ loop, parent: null }))
    .sort((p, q) => Math.abs(signedArea(pos, q.loop, u, v)) - Math.abs(signedArea(pos, p.loop, u, v)));
  for (let i = 0; i < nodes.length; i++) {
    const [cx, cy] = interiorPoint(nodes[i].loop, pos, u, v);
    let parent = null;
    let parentArea = Infinity;
    for (let j = 0; j < i; j++) {
      const area = Math.abs(signedArea(pos, nodes[j].loop, u, v));
      if (area >= parentArea) continue;
      if (pointInLoop(cx, cy, nodes[j].loop, pos, u, v)) {
        parent = nodes[j];
        parentArea = area;
      }
    }
    nodes[i].parent = parent;
  }

  function depth(node) {
    let d = 0;
    let p = node.parent;
    while (p) {
      d++;
      p = p.parent;
    }
    return d;
  }

  let capped = 0;
  for (const node of nodes) {
    if (depth(node) % 2 === 1) continue;
    const group = [node.loop, ...nodes.filter((other) => other.parent === node).map((other) => other.loop)];
    const poly = [];
    const edges = [];
    for (const loop of group) {
      const baseIndex = poly.length;
      for (const vi of loop) poly.push(vi);
      for (let i = 0; i < loop.length; i++) edges.push([baseIndex + i, baseIndex + ((i + 1) % loop.length)]);
    }
    const points = poly.map((vi) => [pos[vi * 3 + u], pos[vi * 3 + v]]);
    let cut = [];
    try {
      cut = cdt2d(points, edges, { exterior: false }) || [];
    } catch {
      cut = [];
    }
    if (cut.length < 1) {
      uncapped++;
      continue;
    }
    for (const tri of cut) floor.push(poly[tri[0]], poly[tri[1]], poly[tri[2]]);
    capped++;
  }

  if (floor.length >= 3) {
    let best = -1;
    let bestArea = -1;
    for (let i = 0; i < floor.length; i += 3) {
      const score = area2(pos, floor[i], floor[i + 1], floor[i + 2]);
      if (score > bestArea) {
        bestArea = score;
        best = i;
      }
    }
    const a = floor[best] * 3;
    const b = floor[best + 1] * 3;
    const c = floor[best + 2] * 3;
    const bx = pos[b] - pos[a];
    const by = pos[b + 1] - pos[a + 1];
    const bz = pos[b + 2] - pos[a + 2];
    const cx = pos[c] - pos[a];
    const cy = pos[c + 1] - pos[a + 1];
    const cz = pos[c + 2] - pos[a + 2];
    const normal = [by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx];
    if (normal[axis] * direction < 0) {
      for (let i = 0; i < floor.length; i += 3) {
        const swap = floor[i + 1];
        floor[i + 1] = floor[i + 2];
        floor[i + 2] = swap;
      }
    }
  }

  const total = prepared.indices.length + wall.length + floor.length;
  const indices = new Uint32Array(total);
  indices.set(prepared.indices, 0);
  indices.set(wall, prepared.indices.length);
  indices.set(floor, prepared.indices.length + wall.length);
  const finalPos = pos.length === vertCount * 3 ? pos : pos.slice(0, vertCount * 3);
  let solid = cleanMesh({ positions: finalPos, indices });
  if (signedVolume(solid.positions, solid.indices) < 0) {
    solid = { positions: solid.positions, indices: flipIndices(solid.indices) };
  }

  const after = edgeCensus(solid.indices);
  const volume = signedVolume(solid.positions, solid.indices);
  return {
    mesh: solid,
    base,
    axis,
    direction,
    openEdgesBefore: before.openEdges,
    openEdges: after.openEdges,
    nonManifold: before.nonManifold,
    unclosedChains: loops.unclosed,
    watertight: after.openEdges === 0 && solid.indices.length >= 12,
    triangles: (solid.indices.length / 3) | 0,
    capped,
    uncapped,
    volume,
  };
}
