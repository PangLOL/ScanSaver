import { cadSolid } from "./cad.js";
import { formMesh } from "./form.js";
import { parseMesh, writeSTL } from "./io.js";
import { boundarySegments, boundsOf, faceCount } from "./mesh.js";
import { sampleScan } from "./sample.js";
import { simplifyMesh } from "./simplify.js";
import { writeSTEP } from "./step.js";

let source = null;
let formed = null;
let formOptions = null;
let sourceName = "scan";

function progress(id, label) {
  self.postMessage({ id, type: "progress", label });
}

async function viewOf(mesh) {
  const cap = 180000;
  if (faceCount(mesh) <= cap) {
    return { positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices) };
  }
  const light = await simplifyMesh(mesh, cap, 0.08);
  return { positions: new Float32Array(light.positions), indices: new Uint32Array(light.indices) };
}

async function publish(id, type, mesh, extra) {
  progress(id, "Preparing the view");
  const view = await viewOf(mesh);
  const edges = boundarySegments(mesh);
  const boundary = new Float32Array(edges.segments);
  self.postMessage(
    {
      id,
      type,
      positions: view.positions,
      indices: view.indices,
      boundary,
      bounds: boundsOf(mesh.positions),
      triangles: faceCount(mesh),
      openEdges: edges.openEdges,
      ...extra,
    },
    [view.positions.buffer, view.indices.buffer, boundary.buffer],
  );
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      progress(msg.id, "Reading the scan");
      source = parseMesh(msg.buffer, msg.ext);
      sourceName = (msg.name || "scan").replace(/\.[^.]+$/, "");
      formed = null;
      formOptions = null;
      progress(msg.id, "Finding open edges");
      await publish(msg.id, "loaded", source, { name: msg.name || "Scan" });
    } else if (msg.type === "sample") {
      progress(msg.id, "Building a sample scan");
      const sample = sampleScan();
      source = sample.mesh;
      sourceName = "sample-scan";
      formed = null;
      formOptions = null;
      await publish(msg.id, "loaded", source, { name: sample.name });
    } else if (msg.type === "form") {
      if (!source) throw new Error("Open a scan first.");
      progress(msg.id, "Dropping open edges");
      const result = formMesh(source, { axis: msg.axis, direction: msg.direction });
      formed = result;
      formOptions = { axis: result.axis, direction: result.direction };
      progress(msg.id, "Capping the base");
      await publish(msg.id, "formed", result.mesh, {
        base: result.base,
        axis: result.axis,
        direction: result.direction,
        openEdgesBefore: result.openEdgesBefore,
        openEdges: result.openEdges,
        nonManifold: result.nonManifold,
        watertight: result.watertight,
        triangles: result.triangles,
        capped: result.capped,
      });
    } else if (msg.type === "stl") {
      if (!formed) throw new Error("Drop the edges before exporting.");
      progress(msg.id, "Writing STL");
      const buffer = writeSTL(formed.mesh, sourceName);
      self.postMessage(
        { id: msg.id, type: "stl", buffer, filename: `${sourceName}-solid.stl`, triangles: formed.triangles },
        [buffer],
      );
    } else if (msg.type === "step") {
      if (!formed) throw new Error("Drop the edges before exporting.");
      progress(msg.id, "Building the CAD solid");
      const solid = await cadSolid(formed.mesh, {
        targetFaces: msg.targetFaces,
        axis: formOptions.axis,
        direction: formOptions.direction,
      });
      progress(msg.id, "Writing STEP");
      const text = writeSTEP(solid.mesh, { name: sourceName, unit: msg.unit || "mm" });
      self.postMessage({
        id: msg.id,
        type: "step",
        text,
        filename: `${sourceName}-solid.step`,
        faces: solid.faces,
        watertight: solid.watertight,
        warnings: solid.warnings,
      });
    }
  } catch (error) {
    self.postMessage({ id: msg.id, type: "error", message: error.message || "Something went wrong." });
  }
};
