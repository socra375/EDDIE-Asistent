// Local development server. Mirrors every api/**.js Vercel function so
// `npm run dev:full` works without the Vercel CLI. In production, Vercel
// calls the api/**.js files directly — this file is dev-only.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { handleChatRequest, errorToResponse } from '../api/_lib/handler.js';
import { parseCookies } from '../api/_lib/cookies.js';
import { applyResult, respondError } from '../api/_lib/respond.js';
import { startGoogleLogin, handleGoogleCallback, logout, me, deleteAccount } from '../api/_lib/authHandlers.js';
import { listUpcomingEvents, createEventFromTask } from '../api/_lib/calendarHandlers.js';
import { saveToDrive } from '../api/_lib/driveHandlers.js';
import { listTasks, createTask, updateTask, removeTask } from '../api/_lib/tasksHandlers.js';
import { getSettings, putSettings } from '../api/_lib/settingsHandlers.js';
import { getMemory, putMemory } from '../api/_lib/memoryHandlers.js';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function cookiesOf(req) {
  return parseCookies(req.headers.cookie);
}

// ---- Chat (Gemini/Claude) ----

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
    database: Boolean(process.env.DATABASE_URL),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

// ---- Auth (Google login) ----

app.get('/api/auth/google/start', (_req, res) => {
  try {
    applyResult(res, startGoogleLogin());
  } catch (err) {
    respondError(res, err);
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    applyResult(res, await handleGoogleCallback(cookiesOf(req), req.query));
  } catch (err) {
    respondError(res, err);
  }
});

// GET/POST/DELETE all served from one path — mirrors api/auth/session.js.
app.get('/api/auth/session', async (req, res) => {
  try {
    applyResult(res, await me(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/auth/session', async (req, res) => {
  try {
    applyResult(res, await logout(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.delete('/api/auth/session', async (req, res) => {
  try {
    applyResult(res, await deleteAccount(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

// ---- Google Calendar / Drive ----

app.get('/api/calendar/events', async (req, res) => {
  try {
    applyResult(res, await listUpcomingEvents(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/calendar/events', async (req, res) => {
  try {
    applyResult(res, await createEventFromTask(cookiesOf(req), req.body));
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/drive/save', async (req, res) => {
  try {
    applyResult(res, await saveToDrive(cookiesOf(req), req.body));
  } catch (err) {
    respondError(res, err);
  }
});

// ---- Tasks / Settings / Memory (signed-in users) ----

app.get('/api/tasks', async (req, res) => {
  try {
    applyResult(res, await listTasks(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    applyResult(res, await createTask(cookiesOf(req), req.body));
  } catch (err) {
    respondError(res, err);
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    applyResult(res, await updateTask(cookiesOf(req), req.params.id, req.body));
  } catch (err) {
    respondError(res, err);
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    applyResult(res, await removeTask(cookiesOf(req), req.params.id));
  } catch (err) {
    respondError(res, err);
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    applyResult(res, await getSettings(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    applyResult(res, await putSettings(cookiesOf(req), req.body));
  } catch (err) {
    respondError(res, err);
  }
});

app.get('/api/memory', async (req, res) => {
  try {
    applyResult(res, await getMemory(cookiesOf(req)));
  } catch (err) {
    respondError(res, err);
  }
});

app.put('/api/memory', async (req, res) => {
  try {
    applyResult(res, await putMemory(cookiesOf(req), req.body));
  } catch (err) {
    respondError(res, err);
  }
});

app.delete('/api/memory', async (req, res) => {
  try {
    applyResult(res, await putMemory(cookiesOf(req), {}));
  } catch (err) {
    respondError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`Eddie API (dev) escuchando en http://localhost:${PORT}`);
});
