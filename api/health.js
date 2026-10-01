// GET /api/health — lets the frontend show which providers/integrations
// are configured without ever exposing the underlying secrets.
import { geminiVoiceStatus } from './_lib/geminiSpeech.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    // The Gemini voice (GEMINI_TTS_VOICE + a key): { label } or null.
    geminiVoice: geminiVoiceStatus(),
    database: Boolean(process.env.DATABASE_URL),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
}
