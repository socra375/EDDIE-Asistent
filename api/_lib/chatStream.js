// Shared between api/chat.js (Vercel) and server/dev-server.js (Express) —
// both `res` objects are plain Node http.ServerResponse under the hood, so
// the same writeHead/write/end/status/json calls work on either.
//
// Wire format is newline-delimited JSON, one object per line:
//   {"type":"chunk","text":"..."}   — a piece of the answer, as generated
//   {"type":"done","provider":...,"model":...,"fallbackFrom":...,"actions":[...]}
//                                     — stream finished (fallbackFrom is set when
//                                       Groq answered for a failed provider;
//                                       actions are app changes the tools
//                                       asked for, e.g. create_task;
//                                       confirmations are sensitive actions
//                                       waiting for the user's OK; steps is the
//                                       receipt of every tool call)
//   {"type":"step","id":"s1","tool":...,"label":...,"activity":...,"status":
//    "running"|"done"|"error"|"waiting","summary":...,"verified":...}
//                                     — a tool call started or ended (same id
//                                       each time); the final list comes again
//                                       in `done`
//   {"type":"error","message":"..."} — failed after the stream had already
//                                       started (see below)
//
// The stream only opens once the first chunk or tool step is ready to
// send. Anything that fails before that (bad request, missing API key,
// quota exceeded, a fully-failed first attempt) still gets a normal HTTP
// status + JSON body, exactly like before streaming existed — a failure
// after that has to use an in-band error event, since the response's
// status code can no longer change once headers are sent (the app handles
// both the same way).
import { handleChatRequest, errorToResponse } from './handler.js';
import { parseCookies } from './cookies.js';
import { lazySessionUser } from './session.js';
import { takeRequest } from './usage/store.js';
import { mirrorImagesToTelegram, mirrorToTelegram } from './telegram/mirror.js';

// While Eddie thinks (a model that takes a while to say its first word, a
// slow tool) nothing is written; after this much silence a small "ping" goes
// out every few seconds so the connection is never taken for dead.
const QUIET_MS = 3000;
const BEAT_MS = 4000;
// The copy to Telegram must not hold the app's answer for long.
const MIRROR_WAIT_MS = 5000;

const lastUserText = (body) => {
  const last = Array.isArray(body?.messages) ? body.messages.at(-1) : null;
  return last?.role === 'user' && typeof last.content === 'string' ? last.content : '';
};

export async function runChatStream(req, res) {
  let streamStarted = false;
  let lastWriteAt = Date.now();
  const ensureStream = () => {
    if (streamStarted) return;
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    streamStarted = true;
  };
  const write = (event) => {
    ensureStream();
    lastWriteAt = Date.now();
    res.write(`${JSON.stringify(event)}\n`);
  };
  const beat = setInterval(() => {
    if (Date.now() - lastWriteAt >= QUIET_MS) write({ type: 'ping' });
  }, BEAT_MS);

  const cookies = parseCookies(req.headers?.cookie);
  const getUser = lazySessionUser(cookies);
  let answer = '';
  let slot = null;
  try {
    // The daily allowance, split in tandas (see usage/quota.js): a signed-in
    // user past their tanda gets a clear 429 before anything is spent.
    const user = process.env.DATABASE_URL ? await getUser() : null;
    slot = await takeRequest(user?.id, { timezone: req.body?.context?.timezone });
    if (!slot.allowed) {
      clearInterval(beat);
      if (streamStarted) {
        write({ type: 'error', message: slot.message });
        res.end();
      } else {
        res.status(429).json({ error: slot.message, code: 'QUOTA', usage: slot.usage });
      }
      return;
    }
    const result = await handleChatRequest(
      req.body,
      (text) => {
        answer += text;
        write({ type: 'chunk', text });
      },
      (step) => write({ type: 'step', ...step }),
      { cookies, getUser },
    );
    ensureStream();
    const done = { type: 'done', provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom };
    if (result.actions?.length) done.actions = result.actions;
    if (result.confirmations?.length) done.confirmations = result.confirmations;
    if (result.steps?.length) done.steps = result.steps;
    write(done);
    clearInterval(beat);
    // The same answer, to the user's Telegram (when the app asked and a chat is linked).
    if (req.body?.mirror === true && user) {
      await Promise.race([
        (async () => {
          await mirrorToTelegram({ userId: user.id, question: lastUserText(req.body), answer, steps: result.steps, confirmations: result.confirmations });
          await mirrorImagesToTelegram({ userId: user.id, actions: result.actions });
        })(),
        new Promise((resolve) => setTimeout(resolve, MIRROR_WAIT_MS)),
      ]);
    }
    res.end();
  } catch (err) {
    clearInterval(beat);
    // Nothing reached the user: the request doesn't count against the tanda.
    if (!answer) await slot?.release?.();
    if (!streamStarted) {
      const { status, body } = errorToResponse(err);
      res.status(status).json(body);
      return;
    }
    const { body } = errorToResponse(err);
    write({ type: 'error', message: body.error });
    res.end();
  }
}
