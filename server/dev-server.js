// Local development server. Mirrors api/chat.js so `npm run dev` works
// without the Vercel CLI. In production, Vercel calls api/chat.js directly.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { handleChatRequest, errorToResponse } from '../api/_lib/handler.js';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/api/chat', async (req, res) => {
  try {
    const result = await handleChatRequest(req.body);
    res.status(200).json(result);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    res.status(status).json(body);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`Eddie API (dev) escuchando en http://localhost:${PORT}`);
});
