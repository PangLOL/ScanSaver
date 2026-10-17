// A small open heightfield with a hole, so the vacuum-form close is visible immediately.
export function sampleScan() {
  const n = 34;
  const size = 120;
  const map = new Int32Array(n * n);
  map.fill(-1);
  const positions = [];
  const indices = [];

  const keep = (i, j) => {
    const u = (i / (n - 1)) * 2 - 1;
    const v = (j / (n - 1)) * 2 - 1;
    const radius = Math.hypot(u, v);
    const limit = 0.9 + 0.05 * Math.sin(5 * Math.atan2(v, u));
    if (radius > limit) return false;
    if (Math.abs(u) < 0.16 && Math.abs(v) < 0.16) return false;
    return true;
  };

  const add = (i, j) => {
    const slot = i * n + j;
    if (map[slot] >= 0) return map[slot];
    const u = (i / (n - 1)) * 2 - 1;
    const v = (j / (n - 1)) * 2 - 1;
    const radius = Math.hypot(u, v);
    const z = 14 + 32 * Math.exp(-2.4 * radius * radius) + 3.5 * Math.sin(3 * u) * Math.cos(2 * v);
    map[slot] = (positions.length / 3) | 0;
    positions.push(u * (size / 2), v * (size / 2), z);
    return map[slot];
  };

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      if (!keep(i, j) || !keep(i + 1, j) || !keep(i, j + 1) || !keep(i + 1, j + 1)) continue;
      indices.push(add(i, j), add(i + 1, j), add(i, j + 1));
      indices.push(add(i + 1, j), add(i + 1, j + 1), add(i, j + 1));
    }
  }

  return {
    mesh: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) },
    name: "Sample scan",
  };
}
