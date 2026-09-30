// Vercel serverless function: POST /api/chat
// Keeps provider API keys server-side; the frontend never sees them.
// Streams the answer as it's generated — see api/_lib/chatStream.js.
// Also hosts the other "talk to Eddie" calls: POST /api/chat?action=
// transcribe (speech to text, Groq Whisper, api/_lib/transcribe.js),
// ?action=speak (text to speech, ElevenLabs, api/_lib/speech.js) and
// ?action=confirm (runs an action the user confirmed on a card,
// api/_lib/confirm.js). Sharing the file keeps the project under Vercel
// Hobby's 12 functions.
import { runChatStream } from './_lib/chatStream.js';
import { runTranscription } from './_lib/transcribe.js';
import { runSpeech } from './_lib/speech.js';
import { runConfirm } from './_lib/confirm.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Audio-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

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

  await runChatStream(req, res);
}
