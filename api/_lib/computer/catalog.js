// The tools an agent says it offers, checked before they are stored or
// shown to the model: plain names, short texts, simple parameter types and a
// risk (read, or confirm for anything that changes the computer). Whatever
// the agent sends, Eddie only ever asks it for tools from this list.
import { validateArgs } from '../connectors/validate.js';

export const MAX_TOOLS = 24;
const MAX_PARAMS = 6;
const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
const TYPES = { string: 'STRING', integer: 'INTEGER', number: 'NUMBER', boolean: 'BOOLEAN' };

// One line of plain text: control characters become spaces.
export const plainText = (value, max) =>
  typeof value === 'string'
    ? Array.from(value, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').trim().slice(0, max)
    : '';
const text = plainText;

function cleanParameters(parameters) {
  const props = parameters && typeof parameters === 'object' && parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {};
  const properties = {};
  for (const [key, spec] of Object.entries(props).slice(0, MAX_PARAMS)) {
    if (!NAME_RE.test(key) || !spec || !TYPES[String(spec.type).toLowerCase()]) continue;
    const clean = { type: String(spec.type).toLowerCase() };
    const description = text(spec.description, 160);
    if (description) clean.description = description;
    if (Array.isArray(spec.enum)) {
      const values = spec.enum.filter((v) => ['string', 'number'].includes(typeof v)).map((v) => (typeof v === 'string' ? v.slice(0, 40) : v)).slice(0, 12);
      if (values.length) clean.enum = values;
    }
    properties[key] = clean;
  }
  const required = Array.isArray(parameters?.required) ? parameters.required.filter((k) => k in properties) : [];
  return { properties, required };
}

// [{ name, label, description, risk, parameters }] → the same, cleaned; unknown
// shapes are dropped, never trusted.
export function sanitizeCatalog(tools) {
  if (!Array.isArray(tools)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object' || !NAME_RE.test(t.name || '') || seen.has(t.name)) continue;
    seen.add(t.name);
    out.push({
      name: t.name,
      label: text(t.label, 60) || t.name,
      description: text(t.description, 300),
      risk: t.risk === 'confirm' ? 'confirm' : 'read',
      parameters: cleanParameters(t.parameters),
    });
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

// The shape validateArgs expects (Gemini-style upper-case types).
function declarationOf(tool) {
  const properties = {};
  for (const [key, spec] of Object.entries(tool.parameters?.properties || {})) {
    properties[key] = { type: TYPES[spec.type], ...(spec.enum ? { enum: spec.enum } : {}) };
  }
  return { name: tool.name, parameters: { type: 'OBJECT', properties, required: tool.parameters?.required || [] } };
}

// The model passes a few common arguments by name (path, limit…) plus an
// optional JSON object for anything else; keep only what this tool declares.
export function argsFor(tool, given = {}) {
  const declared = tool.parameters?.properties || {};
  let extra = {};
  if (typeof given.args_json === 'string' && given.args_json.trim()) {
    try {
      const parsed = JSON.parse(given.args_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed;
      else return { error: 'args_json debe ser un objeto JSON, por ejemplo {"path": "Descargas"}.' };
    } catch {
      return { error: 'args_json no es JSON válido.' };
    }
  }
  const args = {};
  for (const [key, value] of Object.entries({ ...given, ...extra })) {
    if (key === 'tool' || key === 'args_json' || value == null || value === '') continue;
    if (key in declared) args[key] = declared[key].type === 'integer' && typeof value === 'number' ? Math.trunc(value) : value;
  }
  const error = validateArgs(declarationOf(tool), args);
  return error ? { error } : { args };
}

// "disk_usage (Uso del disco)…" — for error messages that let the model retry.
export function listForModel(tools) {
  return tools.map((t) => {
    const params = Object.keys(t.parameters?.properties || {});
    return `${t.name}${params.length ? ` {${params.join(', ')}}` : ''}${t.risk === 'confirm' ? ' [con confirmación]' : ''}`;
  });
}
