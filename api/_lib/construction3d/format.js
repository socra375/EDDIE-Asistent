// The model formats Construction 3D keeps: binary glTF (.glb), STL (binary or
// ASCII) and OBJ (text, one file, no separate .mtl or textures). The format is
// read from the file name, and the first bytes of what arrived must agree with
// it before the project is published.
const CONTENT_TYPES = { glb: 'model/gltf-binary', stl: 'model/stl', obj: 'text/plain' };

export const formatOf = (name) => {
  const match = /\.(glb|stl|obj)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : null;
};

export const contentTypeOf = (format) => CONTENT_TYPES[format];

// Printable text (tabs, line breaks and, for OBJ, UTF-8 comments) for nearly every byte.
function mostlyText(head, allowHigh) {
  if (!head.length) return false;
  let ok = 0;
  for (const b of head) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || (allowHigh && b >= 128)) ok += 1;
  return ok / head.length >= 0.97;
}

// A binary glTF starts with "glTF", version 2, and its own total length.
function isGlb(head, bytes) {
  return head.length >= 12 && head.toString('latin1', 0, 4) === 'glTF' && head.readUInt32LE(4) === 2 && head.readUInt32LE(8) === bytes;
}

// Binary STL: 80 header bytes, a triangle count, then 50 bytes per triangle. ASCII STL: "solid" and facets.
function isStl(head, bytes) {
  if (head.length >= 84 && bytes === 84 + 50 * head.readUInt32LE(80)) return true;
  const text = head.toString('latin1');
  return text.startsWith('solid') && /facet\s+normal/.test(text) && mostlyText(head, false);
}

// OBJ: text with at least one vertex or face line.
function isObj(head) {
  return mostlyText(head, true) && /^\s*(v|f|vn|vt|o|g|s|usemtl|mtllib)\s/m.test(head.toString('utf8'));
}

// `head` is the start of the stored file (up to 4 KB), `bytes` its full size.
export function looksLikeModel(format, head, bytes) {
  if (format === 'glb') return isGlb(head, bytes);
  if (format === 'stl') return isStl(head, bytes);
  if (format === 'obj') return isObj(head);
  return false;
}

export const WHAT_TO_EXPORT = {
  glb: 'Exporta desde Blender con «glTF Binary (.glb)».',
  stl: 'Exporta desde Blender con «Stl (.stl)».',
  obj: 'Exporta desde Blender con «Wavefront (.obj)» (un solo archivo, sin texturas aparte).',
};
