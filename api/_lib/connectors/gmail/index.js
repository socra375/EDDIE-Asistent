// The user's Gmail, through the same Google account as the login plus two
// extra permissions granted from the hub ("Conectar Gmail"): read/search
// (gmail.readonly) and send (gmail.send). Eddie can find, read and
// summarize mail on its own; sending always goes through the confirmation
// card, where the user can edit the recipient, subject and text first.
import { getValidAccessToken, hasGmailAccess } from '../../googleCredentials.js';
import { clip, fetchJson } from '../http.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_RESULTS = 10;
const MAX_BODY_CHARS = 3500;
const MAX_RECIPIENTS = 10;

class GmailError extends Error {}

// The user's valid access token, or a GmailError explaining what's missing.
async function gmailToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new GmailError('Para usar Gmail, inicia sesión con Google y pulsa "Conectar Gmail" en Conectores.');
  if (!(await hasGmailAccess(user.id))) throw new GmailError('Gmail no está conectado: pulsa "Conectar Gmail" en el módulo Conectores.');
  try {
    return await getValidAccessToken(user.id);
  } catch (err) {
    throw new GmailError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a conectar Gmail.');
  }
}

async function gmail(token, path, options = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new GmailError('Google rechazó el acceso a Gmail. Vuelve a pulsar "Conectar Gmail" en Conectores.');
  if (status === 403) throw new GmailError('Falta el permiso de Gmail para esto. Vuelve a pulsar "Conectar Gmail" y acepta todos los permisos.');
  if (status === 404) throw new GmailError('Ese correo ya no existe.');
  if (status === 429) throw new GmailError('Gmail está limitando las solicitudes; inténtalo en un momento.');
  throw new GmailError(data?.error?.message || 'Gmail no respondió en este momento.');
}

// Wraps a tool body so a GmailError becomes a readable { error }.
function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof GmailError) return { error: err.message };
      throw err;
    }
  };
}

function header(message, name) {
  const h = message?.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function decodeBase64Url(data) {
  return Buffer.from(String(data || ''), 'base64url').toString('utf8');
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Plain text of a message: text/plain if there is one, else the HTML
// stripped; plus attachment names.
export function extractBody(payload) {
  let plain = '';
  let html = '';
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename) attachments.push(part.filename);
    else if (part.mimeType === 'text/plain' && part.body?.data && !plain) plain = decodeBase64Url(part.body.data);
    else if (part.mimeType === 'text/html' && part.body?.data && !html) html = decodeBase64Url(part.body.data);
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  const text = (plain || htmlToText(html)).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, attachments };
}

async function searchEmails(args, context) {
  const token = await gmailToken(context);
  const query = clip(args.query, 300) || 'in:inbox';
  const max = Math.min(Math.max(Number.isInteger(args.max_results) ? args.max_results : 6, 1), MAX_RESULTS);
  const list = await gmail(token, `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  const ids = (list?.messages || []).map((m) => m.id);
  if (!ids.length) return { query, emails: [], note: 'No hay correos que coincidan.' };
  const metadata = '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
  const messages = await Promise.all(ids.map((id) => gmail(token, `/messages/${id}?format=metadata${metadata}`).catch(() => null)));
  return {
    query,
    emails: messages.filter(Boolean).map((m) => ({
      id: m.id,
      from: header(m, 'From'),
      subject: header(m, 'Subject') || '(sin asunto)',
      date: header(m, 'Date'),
      snippet: clip(m.snippet, 200),
      unread: (m.labelIds || []).includes('UNREAD'),
    })),
  };
}

async function readEmail(args, context) {
  const token = await gmailToken(context);
  const message = await gmail(token, `/messages/${encodeURIComponent(args.id)}?format=full`);
  const { text, attachments } = extractBody(message.payload);
  return {
    id: message.id,
    from: header(message, 'From'),
    to: header(message, 'To'),
    cc: header(message, 'Cc') || undefined,
    subject: header(message, 'Subject') || '(sin asunto)',
    date: header(message, 'Date'),
    body: text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… (recortado)` : text,
    attachments,
  };
}

// ---- Sending ----

const ADDRESS_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

// "Ana <ana@x.com>, beto@y.com" → validated list, or an error message.
export function parseRecipients(value) {
  const parts = String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return { error: 'Falta el destinatario del correo.' };
  if (parts.length > MAX_RECIPIENTS) return { error: `Máximo ${MAX_RECIPIENTS} destinatarios.` };
  for (const p of parts) {
    const address = p.match(/<([^>]+)>$/)?.[1] || p;
    if (!ADDRESS_RE.test(address)) return { error: `"${p}" no parece una dirección de correo válida.` };
  }
  return { list: parts };
}

function encodeHeader(value) {
  const clean = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

// RFC 2822 message, base64url-encoded as Gmail's send API expects.
export function buildRawEmail({ to, subject, body, inReplyTo, references }) {
  const lines = [`To: ${to.replace(/[\r\n]+/g, ' ')}`, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${[references, inReplyTo].filter(Boolean).join(' ')}`);
  const encodedBody = Buffer.from(String(body || ''), 'utf8').toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${encodedBody}`, 'utf8').toString('base64url');
}

function emailOf(fromHeader) {
  return fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader.trim();
}

async function originalFor(token, replyToId) {
  const metadata = '&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References';
  return gmail(token, `/messages/${encodeURIComponent(replyToId)}?format=metadata${metadata}`);
}

async function prepareSend(args, context) {
  const token = await gmailToken(context);
  let original = null;
  if (args.reply_to_id) original = await originalFor(token, args.reply_to_id);
  const to = args.to || (original ? emailOf(header(original, 'Reply-To') || header(original, 'From')) : '');
  const recipients = parseRecipients(to);
  if (recipients.error) return { error: recipients.error };
  let subject = String(args.subject || '').trim();
  if (!subject && original) {
    const s = header(original, 'Subject');
    subject = /^re:/i.test(s) ? s : `Re: ${s}`;
  }
  if (!subject) return { error: 'El correo necesita un asunto.' };
  const body = String(args.body || '').trim();
  if (!body) return { error: 'El correo está vacío.' };
  if (body.length > 20000) return { error: 'El mensaje es demasiado largo.' };

  const fields = [
    { key: 'to', label: 'Para', value: recipients.list.join(', '), editable: true },
    { key: 'subject', label: 'Asunto', value: subject, editable: true },
    { key: 'body', label: 'Mensaje', value: body, editable: true, multiline: true },
  ];
  if (original) fields.unshift({ key: 'reply', label: 'Responde a', value: header(original, 'Subject') || '(sin asunto)' });
  const prepared = { to: recipients.list.join(', '), subject, body };
  if (args.reply_to_id) prepared.reply_to_id = args.reply_to_id;
  return { args: prepared, preview: { title: original ? 'Responder correo' : 'Enviar correo', confirmLabel: 'Enviar', fields } };
}

async function sendEmail(args, context) {
  const token = await gmailToken(context);
  const payload = {};
  let inReplyTo;
  let references;
  if (args.reply_to_id) {
    const original = await originalFor(token, args.reply_to_id);
    inReplyTo = header(original, 'Message-ID') || undefined;
    references = header(original, 'References') || undefined;
    payload.threadId = original.threadId;
  }
  payload.raw = buildRawEmail({ to: args.to, subject: args.subject, body: args.body, inReplyTo, references });
  const sent = await gmail(token, '/messages/send', { method: 'POST', body: JSON.stringify(payload) });
  // "Comprueba": the message must now be in the Sent folder.
  let verified = null;
  try {
    verified = Boolean((await gmail(token, `/messages/${encodeURIComponent(sent.id)}?format=minimal`))?.labelIds?.includes('SENT'));
  } catch {
    // The send went through; only the check failed.
  }
  const text = `Envié el correo a ${args.to}.`;
  const summary = verified === true ? `${text} Comprobado: está en tu carpeta de enviados.` : verified === false ? `${text} No pude comprobarlo en enviados: revísalo.` : text;
  return { sent: true, id: sent?.id, verified, summary };
}

export default {
  id: 'gmail',
  name: 'Gmail',
  description: 'Eddie busca, lee y resume tus correos, y los envía o responde con tu confirmación.',
  icon: 'mail',
  category: 'comunicacion',
  // Offered to the model only when the conversation touches the topic.
  route: /correo|e-?mail|gmail|bandeja|inbox|mensaje|escrib|respond|reenv|env[ií]a|redact|borrador/i,
  auth: {
    type: 'google-login',
    scope: 'gmail',
    isConnected: (user) => hasGmailAccess(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Eddie nunca envía un correo sin que lo confirmes. No puede borrar correos.',
  tools: [
    {
      label: 'Buscar correos',
      activity: 'Revisando tu correo…',
      summarize: (result) => `${result.emails.length} correo${result.emails.length === 1 ? '' : 's'}`,
      sensitive: false,
      declaration: {
        name: 'search_emails',
        description:
          'Busca correos del usuario en Gmail y devuelve remitente, asunto, fecha, un extracto y si está sin leer. Usa la sintaxis de búsqueda de Gmail en "query" (p. ej. "is:unread in:inbox", "from:banco newer_than:7d", "subject:factura"). Sin query: la bandeja de entrada reciente.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Búsqueda con la sintaxis de Gmail.' },
            max_results: { type: 'INTEGER', description: 'Cuántos correos (1–10, 6 si no se indica).' },
          },
        },
      },
      run: guarded(searchEmails),
    },
    {
      label: 'Leer y resumir correos',
      activity: 'Leyendo el correo…',
      summarize: (result) => `Leído: ${result.subject}`,
      sensitive: false,
      declaration: {
        name: 'read_email',
        description: 'Lee un correo completo por su id (de search_emails) para resumirlo o responderlo.',
        parameters: {
          type: 'OBJECT',
          properties: { id: { type: 'STRING', description: 'El id del correo que devolvió search_emails.' } },
          required: ['id'],
        },
      },
      run: guarded(readEmail),
    },
    {
      label: 'Enviar y responder correos',
      activity: 'Preparando el correo…',
      sensitive: true,
      declaration: {
        name: 'send_email',
        description:
          'Prepara un correo nuevo o una respuesta (con reply_to_id) para enviarlo desde el Gmail del usuario. El usuario lo revisa, puede editarlo y lo confirma en una tarjeta; tú solo lo redactas. Escribe el mensaje completo, con saludo y despedida, en el idioma del destinatario.',
        parameters: {
          type: 'OBJECT',
          properties: {
            to: { type: 'STRING', description: 'Dirección(es) de correo separadas por coma. Opcional si respondes (se usa el remitente original).' },
            subject: { type: 'STRING', description: 'Asunto. Opcional si respondes ("Re: …").' },
            body: { type: 'STRING', description: 'El texto del correo.' },
            reply_to_id: { type: 'STRING', description: 'Id del correo al que se responde, para mantener la conversación.' },
          },
          required: ['body'],
        },
      },
      prepare: guarded(prepareSend),
      run: guarded(sendEmail),
    },
  ],
  webhook: null,
};
