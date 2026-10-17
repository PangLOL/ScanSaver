import { boundsOf, diagonal, faceCount } from "./mesh.js";

function stepString(value) {
  return "'" + String(value).replace(/'/g, "''").replace(/[\r\n]+/g, " ") + "'";
}

function stepNum(value) {
  if (!Number.isFinite(value)) return "0.";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) {
    return value.toExponential(6).replace("e", "E").replace(/E([+-])(\d)$/, "E$10$2").replace(/E([+-])(\d\d)$/, "E$1$2");
  }
  let text = value.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".");
  if (!text.includes(".")) text += ".";
  return text;
}

function lengthUnit(unit) {
  if (unit === "m") return { label: "m", si: "(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.))" };
  if (unit === "cm") return { label: "cm", si: "(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.CENTI.,.METRE.))" };
  if (unit === "in") return { label: "in", si: null };
  return { label: "mm", si: "(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))" };
}

// A watertight triangle mesh as an AP214 manifold solid. Every face is planar.
export function writeSTEP(mesh, options = {}) {
  const faces = faceCount(mesh);
  if (!faces) throw new Error("The solid has no faces to export.");
  const name = options.name || "scan-saver";
  const unit = options.unit || "mm";
  const when = options.date || new Date().toISOString().slice(0, 19);
  const bounds = boundsOf(mesh.positions);
  const accuracy = Math.max(diagonal(bounds) * 1e-7, 1e-7);

  const lines = [];
  let next = 1;
  const add = (body) => {
    const id = next++;
    lines.push(`#${id}=${body};`);
    return id;
  };

  const context = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${context})`);
  const productContext = add(`PRODUCT_CONTEXT('',#${context},'mechanical')`);
  const product = add(`PRODUCT(${stepString(name)},${stepString(name)},'',(#${productContext}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const designContext = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${context},'design')`);
  const definition = add(`PRODUCT_DEFINITION('design','',#${formation},#${designContext})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);

  const chosen = lengthUnit(unit);
  let lengthId;
  if (unit === "in") {
    const milli = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
    const factor = add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#${milli})`);
    const exponents = add("DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)");
    lengthId = add(`(CONVERSION_BASED_UNIT('INCH',#${factor})LENGTH_UNIT()NAMED_UNIT(#${exponents}))`);
  } else {
    lengthId = add(chosen.si);
  }
  const angleId = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const solidAngleId = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const uncertainty = add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${stepNum(accuracy)}),#${lengthId},'distance_accuracy_value','confusion accuracy')`,
  );
  const repContext = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthId},#${angleId},#${solidAngleId}))REPRESENTATION_CONTEXT('','3D'))`,
  );

  const positions = mesh.positions;
  const vertCount = (positions.length / 3) | 0;
  const pointIds = new Array(vertCount);
  const vertexIds = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const o = i * 3;
    pointIds[i] = add(
      `CARTESIAN_POINT('',(${stepNum(positions[o])},${stepNum(positions[o + 1])},${stepNum(positions[o + 2])}))`,
    );
    vertexIds[i] = add(`VERTEX_POINT('',#${pointIds[i]})`);
  }

  const edgeIds = new Map();
  function edgeRecord(a, b) {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo + ":" + hi;
    let rec = edgeIds.get(key);
    if (rec) return rec;
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const dx = positions[b * 3] - ax;
    const dy = positions[b * 3 + 1] - ay;
    const dz = positions[b * 3 + 2] - az;
    const len = Math.hypot(dx, dy, dz);
    if (len === 0) return null;
    const direction = add(`DIRECTION('',(${stepNum(dx / len)},${stepNum(dy / len)},${stepNum(dz / len)}))`);
    const vector = add(`VECTOR('',#${direction},${stepNum(len)})`);
    const line = add(`LINE('',#${pointIds[a]},#${vector})`);
    const curve = add(`EDGE_CURVE('',#${vertexIds[a]},#${vertexIds[b]},#${line},.T.)`);
    rec = { id: curve, start: a, end: b };
    edgeIds.set(key, rec);
    return rec;
  }

  function perpendicular(nx, ny, nz) {
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let tx = 0;
    let ty = 0;
    let tz = 0;
    if (ax <= ay && ax <= az) tx = 1;
    else if (ay <= az) ty = 1;
    else tz = 1;
    let rx = ty * nz - tz * ny;
    let ry = tz * nx - tx * nz;
    let rz = tx * ny - ty * nx;
    const len = Math.hypot(rx, ry, rz) || 1;
    rx /= len;
    ry /= len;
    rz /= len;
    return [rx, ry, rz];
  }

  const faceIds = [];
  const indices = mesh.indices;
  for (let t = 0; t < faces; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const e1 = edgeRecord(a, b);
    const e2 = edgeRecord(b, c);
    const e3 = edgeRecord(c, a);
    if (!e1 || !e2 || !e3) continue;
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax;
    const by = positions[b * 3 + 1] - ay;
    const bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax;
    const cy = positions[c * 3 + 1] - ay;
    const cz = positions[c * 3 + 2] - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen === 0) continue;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    const [rx, ry, rz] = perpendicular(nx, ny, nz);
    const zDir = add(`DIRECTION('',(${stepNum(nx)},${stepNum(ny)},${stepNum(nz)}))`);
    const xDir = add(`DIRECTION('',(${stepNum(rx)},${stepNum(ry)},${stepNum(rz)}))`);
    const place = add(`AXIS2_PLACEMENT_3D('',#${pointIds[a]},#${zDir},#${xDir})`);
    const plane = add(`PLANE('',#${place})`);
    const o1 = add(`ORIENTED_EDGE('',*,*,#${e1.id},${e1.start === a ? ".T." : ".F."})`);
    const o2 = add(`ORIENTED_EDGE('',*,*,#${e2.id},${e2.start === b ? ".T." : ".F."})`);
    const o3 = add(`ORIENTED_EDGE('',*,*,#${e3.id},${e3.start === c ? ".T." : ".F."})`);
    const loop = add(`EDGE_LOOP('',(#${o1},#${o2},#${o3}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    faceIds.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
  }
  if (!faceIds.length) throw new Error("The solid has no faces to export.");

  const chunks = [];
  for (let i = 0; i < faceIds.length; i += 24) {
    chunks.push(faceIds.slice(i, i + 24).map((id) => "#" + id).join(","));
  }
  const shell = add(`CLOSED_SHELL('',(${chunks.join(",\n")}))`);
  const solid = add(`MANIFOLD_SOLID_BREP(${stepString(name)},#${shell})`);
  const representation = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${solid}),#${repContext})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation})`);

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Scan Saver faceted solid'),'2;1');",
    `FILE_NAME(${stepString(name + ".step")},${stepString(when)},('Scan Saver'),('Scan Saver'),'Scan Saver','Scan Saver','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    "ENDSEC;",
    "DATA;",
    lines.join("\n"),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
