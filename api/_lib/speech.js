// Text to speech with ElevenLabs (POST /api/chat?action=speak). The browser
// sends a piece of Eddie's answer and gets MP3 audio back; the
// ELEVENLABS_API_KEY never leaves the server.
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// Eddie's voice, chosen by the user. ELEVENLABS_VOICE_ID overrides it.
export const DEFAULT_VOICE_ID = 'bUQeiO7gn4ehGuSnZf26';
// Flash v2.5 speaks Spanish, answers fastest and costs half the credits of
// Multilingual v2 (twice the minutes on the free plan). ELEVENLABS_MODEL
// switches it, e.g. to eleven_multilingual_v2 for a bit more quality.
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
// The client sends answers sentence by sentence; this caps any one request
// so a single call can't burn a big slice of the monthly credits.
export const MAX_SPEECH_CHARS = 600;

const VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;
const MAX_VOICES = 12;

// Extra voices to choose from in Configuración: ELEVENLABS_VOICES as
// "Name:voiceId" pairs separated by commas, semicolons or new lines
// ("Mayordomo:abc…,Cercano:def…"). A bare id is named by its position.
export function parseVoiceList(raw) {
  const voices = [];
  const seen = new Set();
  for (const part of String(raw || '').split(/[,;\n]+/)) {
    const item = part.trim();
    if (!item) continue;
    const cut = item.lastIndexOf(':');
    const id = (cut >= 0 ? item.slice(cut + 1) : item).trim();
    if (!VOICE_ID_RE.test(id) || seen.has(id)) continue;
    const name = (cut >= 0 ? item.slice(0, cut) : '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || `Voz ${voices.length + 1}`;
    seen.add(id);
    voices.push({ id, name });
    if (voices.length >= MAX_VOICES) break;
  }
  return voices;
}

// The default voice (ELEVENLABS_VOICE_ID, or Eddie's) plus the extra ones —
// the only ids the server will speak with.
export function voiceChoices(env = process.env) {
  const extra = parseVoiceList(env.ELEVENLABS_VOICES);
  const defaultId = VOICE_ID_RE.test(env.ELEVENLABS_VOICE_ID || '') ? env.ELEVENLABS_VOICE_ID : DEFAULT_VOICE_ID;
  const named = extra.find((v) => v.id === defaultId);
  return [{ id: defaultId, name: named?.name || 'Eddie', default: true }, ...extra.filter((v) => v.id !== defaultId)];
}

// For /api/health: the voices to pick from (names and ids only; ids aren't secret).
export function voiceListStatus(env = process.env) {
  if (!env.ELEVENLABS_API_KEY) return [];
  return voiceChoices(env).map(({ id, name, default: isDefault }) => ({ id, name, ...(isDefault ? { default: true } : {}) }));
}

function speechError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function elevenLabsError(status, data) {
  const detail = data?.detail;
  const code = typeof detail === 'object' ? detail?.status || detail?.code : '';
  const raw = typeof detail === 'string' ? detail : detail?.message || '';
  if (status === 401 && /quota|credits/i.test(`${code} ${raw}`)) {
    return speechError('Se acabaron los créditos de ElevenLabs de este mes. Eddie usará la voz del navegador.', 429);
  }
  if (status === 401) return speechError('ElevenLabs rechazó la clave: ELEVENLABS_API_KEY no es válida. Revísala en Vercel.', 502);
  if (status === 402 || /payment|paid_plan|upgrade/i.test(`${code} ${raw}`)) {
    return speechError('Esa voz de ElevenLabs necesita un plan de pago para usarse por API (el plan gratis no permite voces de la biblioteca).', 402);
  }
  if (status === 404 || /voice_not_found/i.test(code)) {
    return speechError('ElevenLabs no encuentra esa voz. Revisa ELEVENLABS_VOICE_ID o agrégala a "My Voices" en tu cuenta.', 502);
  }
  if (status === 429) return speechError('ElevenLabs está ocupado o se alcanzó el límite. Eddie usará la voz del navegador por ahora.', 429);
  return speechError(raw || `ElevenLabs respondió con estado ${status}.`, 502);
}

// Returns the upstream fetch Response (audio/mpeg), ready to be piped.
export async function synthesizeSpeech({
  text,
  voiceId,
  language,
  apiKey = process.env.ELEVENLABS_API_KEY,
  model = process.env.ELEVENLABS_MODEL || DEFAULT_TTS_MODEL,
  env = process.env,
}) {
  if (!apiKey) throw speechError('La voz de ElevenLabs no está configurada (falta ELEVENLABS_API_KEY en Vercel).', 503);
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) throw speechError('No hay texto para leer.', 400);
  if (clean.length > MAX_SPEECH_CHARS) throw speechError(`El fragmento es demasiado largo (máximo ${MAX_SPEECH_CHARS} caracteres).`, 400);
  // Only a voice from the configured list: nobody can make Eddie's key speak
  // with any other voice. Anything else gets the default one.
  const choices = voiceChoices(env);
  const voice = (choices.find((v) => v.id === voiceId) || choices[0]).id;

  const body = { text: clean, model_id: model };
  // Flash/Turbo v2.5 accept a language hint, which keeps short Spanish
  // phrases from being read with an English accent.
  if (/v2_5/.test(model) && /^[a-z]{2}$/.test(language || '')) body.language_code = language;

  const res = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw elevenLabsError(res.status, data);
  }
  return res;
}

// Shared by api/chat.js (Vercel) and server/dev-server.js (Express).
export async function runSpeech(req, res) {
  // Only Eddie's own pages may spend the ElevenLabs credits; browsers mark
  // cross-site requests, so another site can't use this as a free TTS.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }
  try {
    const { text, voiceId, language } = req.body || {};
    const upstream = await synthesizeSpeech({ text, voiceId, language: typeof language === 'string' ? language.slice(0, 2) : '' });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (!err.status) console.error('[speak] unexpected error:', err);
    res.status(err.status || 502).json({ error: err.message || 'No se pudo generar la voz.' });
  }
}
