// Shared argument check for every connector tool. The model can hallucinate
// arguments with the wrong shape (a number where a city name is expected, an
// object instead of a string) — validate against the tool's own declared
// schema before ever running it, rather than letting a malformed value reach
// the tool body and fail in some less obvious way.

const TYPE_CHECKS = {
  STRING: (v) => typeof v === 'string',
  NUMBER: (v) => typeof v === 'number' && Number.isFinite(v),
  INTEGER: (v) => typeof v === 'number' && Number.isInteger(v),
  BOOLEAN: (v) => typeof v === 'boolean',
  OBJECT: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  ARRAY: (v) => Array.isArray(v),
};

export function validateArgs(declaration, args) {
  const properties = declaration.parameters?.properties || {};
  const required = declaration.parameters?.required || [];
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

  for (const key of required) {
    if (!(key in safeArgs)) {
      return `Falta el argumento requerido "${key}" para la herramienta "${declaration.name}".`;
    }
  }

  for (const [key, value] of Object.entries(safeArgs)) {
    const schema = properties[key];
    if (!schema) {
      return `Argumento desconocido "${key}" para la herramienta "${declaration.name}".`;
    }
    const check = TYPE_CHECKS[schema.type];
    if (check && value != null && !check(value)) {
      return `El argumento "${key}" de "${declaration.name}" debe ser de tipo ${schema.type}.`;
    }
  }

  return null;
}
