// Text to speech with Gemini (POST /api/chat?action=speak, engine "gemini").
// Speaks with the voice the user designed or replicated in Google AI Studio
// (an id like voice_…) or with a prebuilt one (Kore, Charon, Puck…), set in
// GEMINI_TTS_VOICE. The key stays on the server: GEMINI_TTS_API_KEY, or
// GEMINI_API_KEY when it's the same project — designed voices only work with
// a key from the project that created them.
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_VOICE = 'Kore';
// Fewer, longer pieces than ElevenLabs: the free tier counts requests (about
// 100 a day), not characters.
export const MAX_GEMINI_SPEECH_CHARS = 1600;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const VOICE_RE = /^[A-Za-z0-9_.:/-]{2,120}$/;
const MODEL_RE = /^[a-z0-9.-]{3,80}$/;

export function geminiVoiceConfig(env = process.env) {
  const apiKey = env.GEMINI_TTS_API_KEY || env.GEMINI_API_KEY || '';
  const voice = VOICE_RE.test(env.GEMINI_TTS_VOICE || '') ? env.GEMINI_TTS_VOICE : DEFAULT_GEMINI_VOICE;
  const model = MODEL_RE.test(env.GEMINI_TTS_MODEL || '') ? env.GEMINI_TTS_MODEL : DEFAULT_GEMINI_TTS_MODEL;
  const style = String(env.GEMINI_TTS_STYLE || '').trim().slice(0, 300);
  return { apiKey, voice, model, style, custom: /^voice(key)?_/.test(voice) };
}

// For /api/health: whether the voice is usable and how to name it (no secrets).
export function geminiVoiceStatus(env = process.env) {
  const { apiKey, voice, custom } = geminiVoiceConfig(env);
  if (!apiKey || !env.GEMINI_TTS_VOICE) return null;
  return { label: custom ? 'tu voz personalizada' : voice };
}

function speechError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function geminiError(status, data, voice) {
  const raw = String(data?.error?.message || '');
  if (status === 429) {
    return speechError('Se alcanzó el límite de la voz de Gemini (el plan gratis da unos 100 audios al día). Eddie sigue con su otra voz.', 429);
  }
  if (status === 401 || (status === 403 && /api key|permission/i.test(raw))) {
    return speechError('Gemini rechazó la clave de la voz: revisa GEMINI_TTS_API_KEY en Vercel.', 403);
  }
  if ((status === 400 || status === 404) && /voice/i.test(raw)) {
    return speechError(
      `Gemini no reconoce la voz «${voice}». Revisa GEMINI_TTS_VOICE: una voz creada solo funciona con una clave del mismo proyecto de AI Studio (GEMINI_TTS_API_KEY).`,
      503,
    );
  }
  if (status === 404) return speechError('Ese modelo de voz de Gemini no existe: revisa GEMINI_TTS_MODEL.', 503);
  return speechError(raw ? `La voz de Gemini falló: ${raw.slice(0, 200)}` : `La voz de Gemini respondió con estado ${status}.`, 502);
}

// A RIFF/WAVE header around raw 16-bit little-endian PCM.
export function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Newer models answer with a complete WAV file; older ones with headerless
// PCM ("audio/L16;codec=pcm;rate=24000"). Either way the browser gets a WAV.
export function audioToWav(data, mimeType = '') {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' || /wav/i.test(mimeType)) return bytes;
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1]) || 24000;
  return pcmToWav(bytes, rate);
}

// Older TTS models (2.5) take the prebuilt-voice form; newer ones a plain voice id.
function voiceConfigFor(model, voice) {
  return /gemini-2\./.test(model) ? { prebuiltVoiceConfig: { voiceName: voice } } : { voice };
}

// → a WAV Buffer for `text`.
export async function synthesizeGeminiSpeech({ text, env = process.env, fetchImpl = globalThis.fetch }) {
  const { apiKey, voice, model, style } = geminiVoiceConfig(env);
  if (!apiKey) throw speechError('La voz de Gemini no está configurada (falta GEMINI_TTS_API_KEY o GEMINI_API_KEY en Vercel).', 503);
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) throw speechError('No hay texto para leer.', 400);
  if (clean.length > MAX_GEMINI_SPEECH_CHARS) throw speechError(`El fragmento es demasiado largo (máximo ${MAX_GEMINI_SPEECH_CHARS} caracteres).`, 400);
  // An optional delivery note ("cálido y sereno") goes before the text, the
  // way Gemini TTS takes direction; the voice itself carries the persona.
  const prompt = style ? `${style}:\n${clean}` : clean;
  const res = await fetchImpl(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: voiceConfigFor(model, voice) } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw geminiError(res.status, data, voice);
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline) throw speechError('Gemini no devolvió audio para ese texto.', 502);
  return audioToWav(inline.data, inline.mimeType || inline.mime_type || '');
}
