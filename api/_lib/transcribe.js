// Speech to text with Groq's hosted Whisper (POST /api/chat?action=transcribe).
// The browser records the user's voice and sends the raw audio here; the
// GROQ_API_KEY never leaves the server. Groq exposes Whisper through the
// OpenAI-compatible /audio/transcriptions endpoint (multipart upload).
import { fetchWithRetry } from './fetchWithRetry.js';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// Turbo is the faster and cheaper one and is plenty for short commands;
// whisper-large-v3 is a little more accurate. GROQ_STT_MODEL overrides it,
// and the other one is tried if Groq no longer offers the configured model.
export const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';
const STT_FALLBACK_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];

// Vercel rejects request bodies over 4.5 MB; about four minutes of the
// browser's Opus audio fits comfortably under this.
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MIN_AUDIO_BYTES = 1000;

const AUDIO_EXTENSIONS = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

// Whisper "hears" these in silence or noise (they come from the subtitles
// it was trained on); a transcription that is only one of them is dropped.
const HALLUCINATIONS = [
  /^gracias( por (ver|su atenci[oó]n))?( el video)?[.!]*$/i,
  /subt[ií]tulos (realizados|hechos) por/i,
  /amara\.org/i,
  /^thank you( for watching)?[.!]*$/i,
  /^\.+$/,
];

function sttError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  if (status) err.status = status;
  return err;
}

function badRequest(message) {
  return sttError(message, 'BAD_REQUEST');
}

export function audioExtension(mimeType) {
  const base = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return AUDIO_EXTENSIONS[base] || null;
}

// Drops segments Whisper itself flags as probably not speech, then any
// leftover that is a known hallucination. Works on verbose_json output.
export function cleanTranscription(data) {
  const segments = Array.isArray(data?.segments) ? data.segments : null;
  let text = segments
    ? segments
        .filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -0.7))
        .map((s) => s.text || '')
        .join('')
    : data?.text || '';
  text = text.replace(/\s+/g, ' ').trim();
  if (HALLUCINATIONS.some((re) => re.test(text))) return '';
  return text;
}

function groqSttError(status, data, model) {
  if (status === 429) return sttError('Se alcanzó el límite gratuito de transcripción de Groq por ahora. Espera un momento.', 'PROVIDER_ERROR', status);
  if (status === 413) return badRequest('La grabación es demasiado larga para transcribirla. Habla en fragmentos más cortos.');
  if (status === 401) return sttError('Groq rechazó la clave: GROQ_API_KEY no es válida o fue revocada. Revísala en Vercel.', 'PROVIDER_ERROR', status);
  if (status === 404 || /does not exist|decommissioned|not found/i.test(data?.error?.message || '')) {
    return sttError(`Groq ya no ofrece el modelo de voz "${model}".`, 'MODEL_MISSING', status);
  }
  if (status === 400) return badRequest(`Groq no pudo leer el audio: ${data?.error?.message || 'formato no válido'}.`);
  return sttError(data?.error?.message || `Groq respondió con estado ${status} al transcribir.`, 'PROVIDER_ERROR', status);
}

async function requestTranscription({ apiKey, model, audio, mimeType, language }) {
  const ext = audioExtension(mimeType) || 'webm';
  const res = await fetchWithRetry(
    GROQ_TRANSCRIBE_URL,
    () => {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mimeType.split(';')[0] }), `voz.${ext}`);
      form.append('model', model);
      form.append('temperature', '0');
      form.append('response_format', 'verbose_json');
      if (language) form.append('language', language);
      return { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(25000) };
    },
    { retries: 1, retryableStatusCodes: [500, 502, 503] },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) throw groqSttError(res.status, data, model);
  return data;
}

// Returns { text, model, language, duration }. `text` is '' when nothing
// intelligible was said (silence, noise), which the client treats as "no
// speech" rather than an error.
export async function transcribeAudio({ audio, mimeType, language, apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL }) {
  if (!apiKey) {
    throw sttError('La voz con Whisper no está configurada (falta GROQ_API_KEY en Vercel).', 'PROVIDER_UNAVAILABLE');
  }
  if (!audioExtension(mimeType)) throw badRequest('Formato de audio no admitido.');
  if (!audio?.length || audio.length < MIN_AUDIO_BYTES) throw badRequest('La grabación está vacía.');
  if (audio.length > MAX_AUDIO_BYTES) throw badRequest('La grabación es demasiado larga para transcribirla. Habla en fragmentos más cortos.');

  const lang = /^[a-z]{2}$/.test(language || '') ? language : undefined;
  const candidates = [model, ...STT_FALLBACK_MODELS.filter((m) => m !== model)];
  let lastError;
  for (const candidate of candidates) {
    try {
      const data = await requestTranscription({ apiKey, model: candidate, audio, mimeType, language: lang });
      return { text: cleanTranscription(data), model: candidate, language: data?.language || lang || null, duration: data?.duration ?? null };
    } catch (err) {
      lastError = err;
      if (err.code !== 'MODEL_MISSING') break;
    }
  }
  if (lastError.code === 'MODEL_MISSING') {
    lastError.code = 'PROVIDER_ERROR';
    lastError.message = 'Groq no ofrece ninguno de los modelos Whisper conocidos. Configura GROQ_STT_MODEL en Vercel con un modelo vigente.';
  }
  throw lastError;
}

// Collects the raw request body. On Vercel the Node helper has usually read
// it already (req.body is a Buffer for application/octet-stream); Express
// with express.raw does the same. Otherwise the stream is read here, with
// the size cap enforced while reading.
export async function readAudioBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === 'object' && !req.readable) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_AUDIO_BYTES) throw badRequest('La grabación es demasiado larga para transcribirla. Habla en fragmentos más cortos.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function statusFor(err) {
  if (err.code === 'BAD_REQUEST') return 400;
  if (err.code === 'PROVIDER_UNAVAILABLE') return 503;
  if (err.status === 429) return 429;
  return 502;
}

// Shared by api/chat.js (Vercel) and server/dev-server.js (Express). The
// audio's real type travels in X-Audio-Type because the body itself is sent
// as application/octet-stream (the only binary type Vercel hands over as-is).
export async function runTranscription(req, res) {
  try {
    const audio = await readAudioBody(req);
    const mimeType = String(req.headers['x-audio-type'] || '');
    const language = String(req.query?.lang || '').slice(0, 2);
    const result = await transcribeAudio({ audio, mimeType, language });
    res.status(200).json(result);
  } catch (err) {
    if (!['BAD_REQUEST', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR'].includes(err.code)) {
      console.error('[transcribe] unexpected error:', err);
    }
    res.status(statusFor(err)).json({ error: err.message || 'No se pudo transcribir el audio.' });
  }
}
