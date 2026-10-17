import { strFromU8, unzipSync } from "fflate";
import { cleanMesh, weldMesh } from "./mesh.js";

function asBytes(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  return new Uint8Array(buffer);
}

function meshFrom(positions, indices) {
  if (indices.length < 3) throw new Error("This file has no triangles.");
  return cleanMesh(weldMesh({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }));
}

export function parseMesh(buffer, extension) {
  const ext = String(extension || "").toLowerCase().replace(/^\./, "");
  const bytes = asBytes(buffer);
  if (ext === "stl") return parseSTL(bytes);
  if (ext === "obj") return parseOBJ(new TextDecoder().decode(bytes));
  if (ext === "ply") return parsePLY(bytes);
  if (ext === "3mf") return parse3MF(bytes);
  throw new Error("Use an STL, OBJ, PLY, or 3MF scan.");
}

function looksLikeAsciiSTL(bytes) {
  if (bytes.length < 15) return true;
  let head = "";
  for (let i = 0; i < 5 && i < bytes.length; i++) head += String.fromCharCode(bytes[i]);
  if (head.toLowerCase() !== "solid") return false;
  if (bytes.length < 84) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const expected = 84 + count * 50;
  return expected !== bytes.length;
}

export function parseSTL(bytes) {
  bytes = asBytes(bytes);
  if (looksLikeAsciiSTL(bytes)) return parseAsciiSTL(new TextDecoder().decode(bytes));
  return parseBinarySTL(bytes);
}

function parseBinarySTL(bytes) {
  if (bytes.length < 84) throw new Error("This STL is too small to contain a mesh.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 > bytes.length + 50) throw new Error("This STL ended before all of its triangles.");
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let offset = 84;
  for (let t = 0; t < count; t++) {
    offset += 12;
    for (let v = 0; v < 9; v++) {
      positions[t * 9 + v] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2;
    indices[t * 3] = t * 3;
    indices[t * 3 + 1] = t * 3 + 1;
    indices[t * 3 + 2] = t * 3 + 2;
  }
  return meshFrom(positions, indices);
}

function parseAsciiSTL(text) {
  const positions = [];
  const indices = [];
  const pattern = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let match;
  let vertex = 0;
  while ((match = pattern.exec(text))) {
    positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
    if ((vertex + 1) % 3 === 0) {
      const base = vertex - 2;
      indices.push(base, base + 1, base + 2);
    }
    vertex++;
  }
  if (vertex % 3 !== 0) throw new Error("This STL has a triangle that is missing a vertex.");
  return meshFrom(positions, indices);
}

export function parseOBJ(text) {
  const positions = [];
  const indices = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const parts = trimmed.split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (trimmed.startsWith("f ")) {
      const parts = trimmed.split(/\s+/).slice(1);
      const verts = (positions.length / 3) | 0;
      const ids = parts.map((token) => {
        const raw = Number(token.split("/")[0]);
        if (!Number.isFinite(raw) || raw === 0) throw new Error("This OBJ has a face with a bad index.");
        return raw < 0 ? verts + raw : raw - 1;
      });
      for (let i = 1; i < ids.length - 1; i++) indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return meshFrom(positions, indices);
}

const PLY_SIZE = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function readPlyScalar(view, offset, type, little) {
  switch (type) {
    case "char":
    case "int8":
      return view.getInt8(offset);
    case "uchar":
    case "uint8":
      return view.getUint8(offset);
    case "short":
    case "int16":
      return view.getInt16(offset, little);
    case "ushort":
    case "uint16":
      return view.getUint16(offset, little);
    case "int":
    case "int32":
      return view.getInt32(offset, little);
    case "uint":
    case "uint32":
      return view.getUint32(offset, little);
    case "float":
    case "float32":
      return view.getFloat32(offset, little);
    case "double":
    case "float64":
      return view.getFloat64(offset, little);
    default:
      throw new Error("This PLY uses an unsupported value type.");
  }
}

export function parsePLY(bytes) {
  bytes = asBytes(bytes);
  const decoder = new TextDecoder();
  let headerEnd = -1;
  const step = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 256000)));
  const marker = step.indexOf("end_header");
  if (marker < 0) throw new Error("This PLY is missing its header.");
  const after = step.indexOf("\n", marker);
  headerEnd = after < 0 ? marker + "end_header".length : after + 1;
  const header = step.slice(0, headerEnd);
  const lines = header.split(/\r?\n/);
  let format = "";
  let element = null;
  const elements = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") format = parts[1];
    else if (parts[0] === "element") {
      element = { name: parts[1], count: Number(parts[2]), props: [] };
      elements.push(element);
    } else if (parts[0] === "property" && element) {
      if (parts[1] === "list") element.props.push({ list: true, countType: parts[2], type: parts[3], name: parts[4] });
      else element.props.push({ list: false, type: parts[1], name: parts[2] });
    }
  }
  const vertexEl = elements.find((item) => item.name === "vertex");
  const faceEl = elements.find((item) => item.name === "face");
  if (!vertexEl || !faceEl) throw new Error("This PLY has no vertex or face data.");
  if (format !== "ascii" && format !== "binary_little_endian" && format !== "binary_big_endian") {
    throw new Error("This PLY format is not supported.");
  }

  return parsePlyElementsInOrder(bytes, headerEnd, format, elements);
}

function parsePlyElementsInOrder(bytes, headerEnd, format, elements) {
  const positions = [];
  const rawIndices = [];
  const ascii = format === "ascii";
  const little = format !== "binary_big_endian";
  const decoder = new TextDecoder();
  let tokens = null;
  let cursor = 0;
  let offset = headerEnd;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const takeToken = () => {
    if (!tokens) tokens = decoder.decode(bytes.subarray(headerEnd)).trim().split(/\s+/);
    if (cursor >= tokens.length) throw new Error("This PLY ended early.");
    return tokens[cursor++];
  };
  let vertexCount = 0;
  for (const el of elements) {
    const xi = el.props.findIndex((prop) => prop.name === "x");
    const yi = el.props.findIndex((prop) => prop.name === "y");
    const zi = el.props.findIndex((prop) => prop.name === "z");
    const listProp = el.props.find((prop) => prop.list && /vertex_ind/i.test(prop.name));
    for (let n = 0; n < el.count; n++) {
      if (ascii) {
        const values = [];
        for (const prop of el.props) {
          if (!prop.list) values.push(Number(takeToken()));
          else {
            const len = Number(takeToken());
            const list = [];
            for (let k = 0; k < len; k++) list.push(Number(takeToken()));
            values.push(list);
          }
        }
        if (xi >= 0) {
          positions.push(values[xi], values[yi], values[zi]);
          vertexCount++;
        }
        if (listProp) {
          const list = values[el.props.indexOf(listProp)];
          for (let k = 1; k < list.length - 1; k++) rawIndices.push(list[0], list[k], list[k + 1]);
        }
      } else {
        const values = [];
        for (const prop of el.props) {
          if (!prop.list) {
            values.push(readPlyScalar(view, offset, prop.type, little));
            offset += PLY_SIZE[prop.type];
          } else {
            const len = readPlyScalar(view, offset, prop.countType, little);
            offset += PLY_SIZE[prop.countType];
            const list = [];
            for (let k = 0; k < len; k++) {
              list.push(readPlyScalar(view, offset, prop.type, little));
              offset += PLY_SIZE[prop.type];
            }
            values.push(list);
          }
        }
        if (offset > bytes.length) throw new Error("This PLY ended early.");
        if (xi >= 0) {
          positions.push(values[xi], values[yi], values[zi]);
          vertexCount++;
        }
        if (listProp) {
          const list = values[el.props.indexOf(listProp)];
          for (let k = 1; k < list.length - 1; k++) rawIndices.push(list[0], list[k], list[k + 1]);
        }
      }
    }
  }
  if (!vertexCount || !rawIndices.length) throw new Error("This PLY has no triangles.");
  return meshFrom(positions, rawIndices);
}

function xmlAttr(tag, name) {
  const match = tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*\"([^\"]*)\"", "i"));
  return match ? match[1] : null;
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function matrixFromTransform(text) {
  if (!text) return identityMatrix();
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== 12 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("This 3MF has a transform that cannot be read.");
  }
  return [
    values[0], values[3], values[6], values[9],
    values[1], values[4], values[7], values[10],
    values[2], values[5], values[8], values[11],
    0, 0, 0, 1,
  ];
}

function multiplyMatrix(left, right) {
  const out = new Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out[row * 4 + col] =
        left[row * 4] * right[col] +
        left[row * 4 + 1] * right[4 + col] +
        left[row * 4 + 2] * right[8 + col] +
        left[row * 4 + 3] * right[12 + col];
    }
  }
  return out;
}

function applyMatrix(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ];
}

function collect3mf(xml) {
  const objects = new Map();
  const objectPattern = /<([\w.:-]*object)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = objectPattern.exec(xml))) {
    const body = match[3];
    const vertices = [];
    const vertexPattern = /<[\w.:-]*vertex\b([^>]*)\/?>/gi;
    let vertexMatch;
    while ((vertexMatch = vertexPattern.exec(body))) {
      vertices.push(Number(xmlAttr(vertexMatch[1], "x")), Number(xmlAttr(vertexMatch[1], "y")), Number(xmlAttr(vertexMatch[1], "z")));
    }
    const triangles = [];
    const trianglePattern = /<[\w.:-]*triangle\b([^>]*)\/?>/gi;
    let triangleMatch;
    while ((triangleMatch = trianglePattern.exec(body))) {
      const a = Number(xmlAttr(triangleMatch[1], "v1"));
      const b = Number(xmlAttr(triangleMatch[1], "v2"));
      const c = Number(xmlAttr(triangleMatch[1], "v3"));
      triangles.push(a, b, c);
    }
    const components = [];
    const componentPattern = /<[\w.:-]*component\b([^>]*)\/?>/gi;
    let componentMatch;
    while ((componentMatch = componentPattern.exec(body))) {
      components.push({
        id: xmlAttr(componentMatch[1], "objectid"),
        transform: xmlAttr(componentMatch[1], "transform"),
      });
    }
    objects.set(xmlAttr(match[2], "id"), { vertices, triangles, components });
  }

  const items = [];
  const itemPattern = /<[\w.:-]*item\b([^>]*)\/?>/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(xml))) {
    items.push({ id: xmlAttr(itemMatch[1], "objectid"), transform: xmlAttr(itemMatch[1], "transform") });
  }
  if (!items.length) {
    for (const id of objects.keys()) items.push({ id, transform: null });
  }

  const positions = [];
  const indices = [];
  function appendObject(id, matrix, stack) {
    const object = objects.get(id);
    if (!object) throw new Error("This 3MF build points at a missing object.");
    if (stack.has(id)) throw new Error("This 3MF has objects that refer to each other in a loop.");
    stack.add(id);
    if (object.triangles.length >= 3) {
      const base = (positions.length / 3) | 0;
      for (let i = 0; i < object.vertices.length; i += 3) {
        const point = applyMatrix(matrix, object.vertices[i], object.vertices[i + 1], object.vertices[i + 2]);
        positions.push(point[0], point[1], point[2]);
      }
      for (const index of object.triangles) indices.push(index + base);
    }
    for (const component of object.components) {
      appendObject(component.id, multiplyMatrix(matrix, matrixFromTransform(component.transform)), stack);
    }
    stack.delete(id);
  }

  for (const item of items) appendObject(item.id, matrixFromTransform(item.transform), new Set());
  return { positions, indices };
}

export function parse3MF(bytes) {
  bytes = asBytes(bytes);
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This 3MF could not be opened.");
  }
  const names = Object.keys(files).filter((name) => name.toLowerCase().endsWith(".model"));
  if (!names.length) throw new Error("This 3MF has no mesh.");
  names.sort((a, b) => Number(a.toLowerCase().endsWith("3d/3dmodel.model")) - Number(b.toLowerCase().endsWith("3d/3dmodel.model")));
  names.reverse();
  const positions = [];
  const indices = [];
  for (const name of names) {
    const part = collect3mf(strFromU8(files[name]));
    if (part.indices.length < 3) continue;
    const base = (positions.length / 3) | 0;
    positions.push(...part.positions);
    for (const index of part.indices) indices.push(index + base);
    if (name.toLowerCase().endsWith("3d/3dmodel.model")) break;
  }
  if (indices.length < 3) throw new Error("This 3MF has no triangles.");
  return meshFrom(positions, indices);
}

export function writeSTL(mesh, name = "scan") {
  const faces = (mesh.indices.length / 3) | 0;
  const buffer = new ArrayBuffer(84 + faces * 50);
  const view = new DataView(buffer);
  const header = `Scan Saver ${name}`.slice(0, 80);
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
  view.setUint32(80, faces, true);
  const pos = mesh.positions;
  let offset = 84;
  for (let t = 0; t < faces; t++) {
    const a = mesh.indices[t * 3] * 3;
    const b = mesh.indices[t * 3 + 1] * 3;
    const c = mesh.indices[t * 3 + 2] * 3;
    const bx = pos[b] - pos[a];
    const by = pos[b + 1] - pos[a + 1];
    const bz = pos[b + 2] - pos[a + 2];
    const cx = pos[c] - pos[a];
    const cy = pos[c + 1] - pos[a + 1];
    const cz = pos[c + 2] - pos[a + 2];
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    offset += 12;
    for (const p of [a, b, c]) {
      view.setFloat32(offset, pos[p], true);
      view.setFloat32(offset + 4, pos[p + 1], true);
      view.setFloat32(offset + 8, pos[p + 2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}
