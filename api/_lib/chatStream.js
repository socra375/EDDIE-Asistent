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

export async function runChatStream(req, res) {
  let streamStarted = false;
  const ensureStream = () => {
    if (streamStarted) return;
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    streamStarted = true;
  };

  try {
    const result = await handleChatRequest(
      req.body,
      (text) => {
        ensureStream();
        res.write(`${JSON.stringify({ type: 'chunk', text })}\n`);
      },
      (step) => {
        ensureStream();
        res.write(`${JSON.stringify({ type: 'step', ...step })}\n`);
      },
      { cookies: parseCookies(req.headers?.cookie) },
    );
    ensureStream();
    const done = { type: 'done', provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom };
    if (result.actions?.length) done.actions = result.actions;
    if (result.confirmations?.length) done.confirmations = result.confirmations;
    if (result.steps?.length) done.steps = result.steps;
    res.write(`${JSON.stringify(done)}\n`);
    res.end();
  } catch (err) {
    if (!streamStarted) {
      const { status, body } = errorToResponse(err);
      res.status(status).json(body);
      return;
    }
    const { body } = errorToResponse(err);
    res.write(`${JSON.stringify({ type: 'error', message: body.error })}\n`);
    res.end();
  }
}
