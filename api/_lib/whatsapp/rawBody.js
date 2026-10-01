// Meta signs the exact bytes of each webhook delivery, so the webhook wants
// the raw body, not only the parsed JSON. Vercel parses the body lazily (the
// first time `req.body` is read), so for this one route the stream is read
// here first and `req.body` is never touched; where something already parsed
// it (the local Express server, which keeps `rawBody`), that is used instead.
const MAX_BYTES = 2 * 1024 * 1024;

export async function readWebhookBody(req) {
  const own = Object.getOwnPropertyDescriptor(req, 'body');
  const lazy = Boolean(own && typeof own.get === 'function');
  if (!lazy) return { rawBody: req.rawBody || null, body: req.body };
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) throw Object.assign(new Error('El cuerpo es demasiado grande.'), { code: 'BAD_REQUEST' });
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    let body = null;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      body = null;
    }
    return { rawBody, body };
  }
  // The stream is gone: use whatever the platform parsed.
  return { rawBody: null, body: req.body };
}
