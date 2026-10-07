// /api/connectors/brain — documents for the two brains:
//   POST brain/document  { name, text, target: 'memory' | 'knowledge', timezone? }
//     target 'knowledge': becomes a topic of the second brain (server-side, → { topic, noteCount, … })
//     target 'memory':    memory items to apply in the app (→ { actions, counts, label, … })
// Counts as one request of the day's allowance (api/_lib/usage/), since it is an AI call.
import { requireUser } from '../session.js';
import { loadSettings } from '../telegram/serverActions.js';
import { takeRequest } from '../usage/store.js';
import { BrainError, MAX_DOCUMENT_CHARS } from './analyze.js';
import { ingestDocument } from './ingest.js';

const STATUS = { BAD_REQUEST: 400, FULL: 409, NOTHING_USEFUL: 422, RATE_LIMITED: 429, PROVIDER_UNAVAILABLE: 503, TIMEOUT: 504, PROVIDER_ERROR: 502 };
// What the request may carry (the analysis itself reads MAX_DOCUMENT_CHARS of it).
const MAX_RAW_CHARS = MAX_DOCUMENT_CHARS * 3;

export async function handleBrainRoute({ method, path = [], cookies = {}, body }) {
  if (path[1] !== 'document' || method !== 'POST') return { status: 404, json: { error: 'Esa acción del cerebro no existe.' } };
  const user = await requireUser(cookies);
  const target = body?.target;
  if (target !== 'memory' && target !== 'knowledge') return { status: 400, json: { error: 'Indica en qué cerebro va el documento (memory o knowledge).' } };
  if (typeof body?.text !== 'string' || !body.text.trim()) return { status: 400, json: { error: 'El documento está vacío.' } };
  if (body.text.length > MAX_RAW_CHARS) return { status: 413, json: { error: 'El documento es demasiado grande (máximo unos 350.000 caracteres).' } };
  if (target === 'knowledge' && !process.env.GEMINI_API_KEY) return { status: 503, json: { error: 'Falta configurar en Vercel: GEMINI_API_KEY.' } };

  const settings = await loadSettings(user.id);
  if (target === 'knowledge' && (settings.disabledConnectors || []).includes('knowledge')) return { status: 409, json: { error: 'El segundo cerebro está apagado en Conectores.' } };
  if (target === 'memory' && settings.memoryEnabled === false) return { status: 409, json: { error: 'La memoria está apagada en Configuración.' } };

  const slot = await takeRequest(user.id, { timezone: body.timezone });
  if (!slot.allowed) return { status: 429, json: { error: slot.message, code: 'QUOTA' } };
  try {
    const result = await ingestDocument({ userId: user.id, name: typeof body.name === 'string' ? body.name : '', text: body.text, target });
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: result };
  } catch (err) {
    await slot.release();
    if (err instanceof BrainError) return { status: STATUS[err.code] || 502, json: { error: err.message, code: err.code } };
    throw err;
  }
}
