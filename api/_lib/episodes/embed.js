// Text embeddings with Gemini (gemini-embedding-001), used to find past
// conversations by meaning. GEMINI_API_KEY never leaves the server.
// 768 dimensions keep each row small (the model supports 128–3072) and are
// L2-normalized here, as Google recommends for anything under 3072.
import { fetchJson } from '../connectors/http.js';

export const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_MODEL = 'gemini-embedding-001';
const MAX_INPUT_CHARS = 6000;

class EmbeddingError extends Error {
  constructor(message, code = 'PROVIDER_ERROR') {
    super(message);
    this.code = code;
  }
}

export function normalize(values) {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? values.map((v) => v / norm) : values;
}

// taskType: RETRIEVAL_DOCUMENT for what is stored, RETRIEVAL_QUERY for what
// is searched; the model tunes the vector for each side.
export async function embedText(text, { taskType = 'RETRIEVAL_DOCUMENT', apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_MODEL } = {}) {
  if (!apiKey) throw new EmbeddingError('La memoria de conversaciones necesita GEMINI_API_KEY en Vercel.', 'PROVIDER_UNAVAILABLE');
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
  if (!clean) throw new EmbeddingError('No hay texto para guardar en la memoria.', 'BAD_REQUEST');
  const { ok, status, data } = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: clean }] }, taskType, outputDimensionality: EMBEDDING_DIMENSIONS }),
    timeoutMs: 8000,
  });
  if (!ok) {
    if (status === 429) throw new EmbeddingError('Gemini alcanzó su límite de uso; la memoria de conversaciones se reanuda en un rato.');
    if (status === 400 || status === 403) throw new EmbeddingError(data?.error?.message || 'Gemini rechazó la solicitud de embeddings (revisa GEMINI_API_KEY).');
    throw new EmbeddingError(data?.error?.message || 'Gemini no respondió para generar los embeddings.');
  }
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) throw new EmbeddingError('Gemini devolvió un embedding inesperado.');
  return normalize(values);
}

// What pgvector reads: '[0.1,0.2,…]'.
export const toVector = (values) => `[${values.map((v) => Number(v.toFixed(7))).join(',')}]`;
