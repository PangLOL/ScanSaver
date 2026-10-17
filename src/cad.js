import { formMesh } from "./form.js";
import { edgeCensus, faceCount } from "./mesh.js";
import { simplifyMesh } from "./simplify.js";

// The STL keeps every formed triangle. STEP uses a lighter closed solid so CAD can open it.
export async function cadSolid(formed, options) {
  const targetFaces = Math.max(50, options.targetFaces | 0 || 8000);
  const warnings = [];
  let mesh = formed;
  let reduced = false;
  if (faceCount(mesh) > targetFaces) {
    mesh = await simplifyMesh(mesh, targetFaces);
    reduced = true;
  }
  let census = edgeCensus(mesh.indices);
  if (census.openEdges > 0) {
    const closed = formMesh(mesh, { axis: options.axis, direction: options.direction });
    mesh = closed.mesh;
    census = edgeCensus(mesh.indices);
  }
  const faces = faceCount(mesh);
  const watertight = census.openEdges === 0 && faces >= 4;
  if (!watertight) {
    warnings.push("The STEP solid is still open. Some CAD tools will import it as surfaces instead of a solid.");
  } else if (census.nonManifold > 0) {
    warnings.push("Some edges are non-manifold. A CAD kernel may refuse the solid or sew it on import.");
  }
  if (reduced && faces > targetFaces * 1.15) {
    warnings.push(
      `The solid has ${faces.toLocaleString("en-US")} faces. The CAD target was ${targetFaces.toLocaleString("en-US")}. A tighter cut would have warped the scan, so the extra faces were kept.`,
    );
  }
  return { mesh, faces, watertight, reduced, warnings };
}
