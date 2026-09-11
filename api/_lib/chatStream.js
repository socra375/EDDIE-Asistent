// Shared between api/chat.js (Vercel) and server/dev-server.js (Express) —
// both `res` objects are plain Node http.ServerResponse under the hood, so
// the same writeHead/write/end/status/json calls work on either.
//
// Wire format is newline-delimited JSON, one object per line:
//   {"type":"chunk","text":"..."}   — a piece of the answer, as generated
//   {"type":"done","provider":...,"model":...} — stream finished
//   {"type":"error","message":"..."} — failed after the stream had already
//                                       started (see below)
//
// The stream only opens once the first chunk is ready to send. Anything
// that fails before that (bad request, missing API key, quota exceeded,
// a fully-failed first attempt) still gets a normal HTTP status + JSON
// body, exactly like before streaming existed — only a genuine mid-stream
// failure (rare: the connection drops after real content was already
// shown) has to fall back to an in-band error event, since the response's
// status code can no longer change once headers are sent.
import { handleChatRequest, errorToResponse } from './handler.js';

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
    const result = await handleChatRequest(req.body, (text) => {
      ensureStream();
      res.write(`${JSON.stringify({ type: 'chunk', text })}\n`);
    });
    ensureStream();
    res.write(`${JSON.stringify({ type: 'done', provider: result.provider, model: result.model })}\n`);
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
