import { MeshoptSimplifier } from "meshoptimizer";
import { cleanMesh, compactMesh } from "./mesh.js";

let ready = null;

function simplifierReady() {
  if (!MeshoptSimplifier.supported) return Promise.reject(new Error("This browser cannot reduce the mesh for CAD."));
  if (!ready) ready = MeshoptSimplifier.ready;
  return ready;
}

// Reduce a mesh toward a face budget. Error stays within 2% of the part size.
export async function simplifyMesh(mesh, targetFaces, maxError = 0.02) {
  await simplifierReady();
  const target = Math.max(4, targetFaces | 0) * 3;
  if (mesh.indices.length <= target) return compactMesh(mesh);
  let best = mesh.indices;
  let error = 0.0005;
  const ceiling = maxError;
  while (error <= ceiling + 1e-12) {
    const [next] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, Math.min(target, mesh.indices.length), error);
    if (next.length < best.length) best = next;
    if (best.length <= target * 1.05) break;
    error *= 2;
  }
  return cleanMesh(compactMesh({ positions: mesh.positions, indices: best }));
}
