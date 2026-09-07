// Vercel serverless function: POST /api/chat
// Keeps provider API keys server-side; the frontend never sees them.
import { handleChatRequest, errorToResponse } from './_lib/handler.js';

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

  try {
    const result = await handleChatRequest(req.body);
    res.status(200).json(result);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    res.status(status).json(body);
  }
}
