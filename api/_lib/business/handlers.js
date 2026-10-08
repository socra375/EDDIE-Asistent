// /api/connectors/business — the Negocios screen (the third brain):
//   GET  business                       every thing kept, newest first, with the client value worked out
//   POST business/save   { area, title, summary?, status?, value?, amount?, related?, note? }
//   POST business/delete { id }
//   POST business/note   { id, index }  removes one note
import { requireUser } from '../session.js';
import { areaOf, clientValue, cleanTitle } from '../../../src/services/business.js';
import { deleteBusiness, listBusiness, removeNote, saveBusiness } from './store.js';

const UUID = /^[0-9a-f-]{36}$/i;
const missingEnv = () => ['DATABASE_URL'].filter((name) => !process.env[name]);

// The nodes as the screen shows them: a client carries his value and the reasons for it.
export function withAnalysis(nodes) {
  return nodes.map((node) => (node.area === 'clientes' ? { ...node, analysis: clientValue(node, nodes) } : node));
}

export async function handleBusinessRoute({ method, path = [], cookies = {}, body }) {
  const sub = path[1];
  const user = await requireUser(cookies);
  const missing = missingEnv();

  if (!sub && method === 'GET') {
    if (missing.length) return { status: 200, json: { configured: false, missing, nodes: [] } };
    const nodes = await listBusiness(user.id);
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { configured: true, nodes: withAnalysis(nodes) } };
  }
  if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
  if (sub === 'save' && method === 'POST') {
    const area = areaOf(body?.area)?.id;
    if (!area) return { status: 400, json: { error: 'Elige un área: clientes, negocios, cómo hablo, contexto, precios o cómo trabajo.' } };
    if (!cleanTitle(body?.title)) return { status: 400, json: { error: 'Dime el nombre (un cliente, un negocio, un precio…).' } };
    const out = await saveBusiness(user.id, { ...body, area, source: 'screen' });
    if (out.error) return { status: 409, json: { error: out.error } };
    return { status: 200, json: { node: out.node, created: out.created } };
  }
  if (sub === 'delete' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica lo que quieres borrar.' } };
    const removed = await deleteBusiness(user.id, body.id);
    return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Eso ya no está guardado.' } };
  }
  if (sub === 'note' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica lo que quieres cambiar.' } };
    const removed = await removeNote(user.id, body.id, Number(body?.index));
    return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Esa nota ya no existe.' } };
  }
  return { status: 404, json: { error: 'Esa acción del tercer cerebro no existe.' } };
}
