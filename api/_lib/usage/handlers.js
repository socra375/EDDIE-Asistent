// /api/connectors/usage — the daily allowance, for Configuración:
//   GET  usage          ?timezone=…  what each tanda has used
//   POST usage/restore  { timezone? } gives the running tanda its allowance back
import { requireUser } from '../session.js';
import { restoreTanda, usageFor } from './store.js';

export async function handleUsageRoute({ method, path = [], cookies = {}, query = {}, body }) {
  const user = await requireUser(cookies);
  const sub = path[1];
  if (!sub && method === 'GET') return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: await usageFor(user.id, { timezone: query.timezone }) };
  if (sub === 'restore' && method === 'POST') return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: await restoreTanda(user.id, { timezone: body?.timezone }) };
  return { status: 404, json: { error: 'Esa acción de uso no existe.' } };
}
