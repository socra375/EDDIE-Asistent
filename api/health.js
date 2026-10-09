// GET /api/health — lets the frontend show which providers/integrations
// are configured without ever exposing the underlying secrets.
import { voiceListStatus } from './_lib/speech.js';
import { applyCors } from './_lib/requestGuard.js';

export default function handler(req, res) {
  applyCors(req, res, { methods: 'GET, OPTIONS' });
  res.status(200).json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    cerebras: Boolean(process.env.CEREBRAS_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    // Voices to choose from in Configuración (ELEVENLABS_VOICE_ID + ELEVENLABS_VOICES).
    elevenVoices: voiceListStatus(),
    database: Boolean(process.env.DATABASE_URL),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
}
