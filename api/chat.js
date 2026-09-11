// Vercel serverless function: POST /api/chat
// Keeps provider API keys server-side; the frontend never sees them.
// Streams the answer as it's generated — see api/_lib/chatStream.js.
import { runChatStream } from './_lib/chatStream.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  await runChatStream(req, res);
}
