// Vercel serverless function: POST /api/chat
// Keeps provider API keys server-side; the frontend never sees them.
// Streams the answer as it's generated — see api/_lib/chatStream.js.
// Also hosts the other "talk to Eddie" calls: POST /api/chat?action=
// transcribe (speech to text, Groq Whisper, api/_lib/transcribe.js),
// ?action=speak (text to speech, ElevenLabs, api/_lib/speech.js) and
// ?action=confirm (runs an action the user confirmed on a card,
// api/_lib/confirm.js) and ?action=vision (what is in a camera frame, for
// Modo Vigilancia, api/_lib/vision.js). Sharing the file keeps the project under Vercel
// Hobby's 12 functions.
import { runChatStream } from './_lib/chatStream.js';
import { runTranscription } from './_lib/transcribe.js';
import { runSpeech } from './_lib/speech.js';
import { runConfirm } from './_lib/confirm.js';
import { runVision } from './_lib/vision.js';
import { applyCors } from './_lib/requestGuard.js';
import { tooMany } from './_lib/rateLimit.js';

export default async function handler(req, res) {
  // Only Eddie's own page (or one listed in ALLOWED_ORIGINS) may use this: every
  // call spends the owner's AI quota. No more `Access-Control-Allow-Origin: *`.
  const untrusted = applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(untrusted ? 403 : 204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  if (untrusted) {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }

  // A few a minute per address (the owner can raise them); vision has its own.
  const action = req.query?.action;
  const limits = { transcribe: ['transcribe', 40, 'TRANSCRIBE_MAX_PER_MINUTE'], speak: ['speak', 120, 'SPEAK_MAX_PER_MINUTE'], confirm: ['confirm', 60, 'CONFIRM_MAX_PER_MINUTE'] };
  if (action !== 'vision' && tooMany(req, res, ...(limits[action] || ['chat', 60, 'CHAT_MAX_PER_MINUTE']))) return;

  if (req.query?.action === 'transcribe') {
    await runTranscription(req, res);
    return;
  }
  if (req.query?.action === 'speak') {
    await runSpeech(req, res);
    return;
  }
  if (req.query?.action === 'confirm') {
    await runConfirm(req, res);
    return;
  }

  if (req.query?.action === 'vision') {
    await runVision(req, res);
    return;
  }

  await runChatStream(req, res);
}
