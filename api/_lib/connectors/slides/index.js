// Google Slides: Eddie makes a presentation in the user's Drive from a title,
// an optional subtitle and slides with a title and bullet points, and gives
// the user the link to edit it. The permission ("presentations") is granted
// from the hub ("Conectar Google Slides"); it creates and edits presentations
// and nothing else. Creating a file is easy to undo (the user can trash it),
// so it runs at once, without a confirmation card.
import { randomUUID } from 'node:crypto';
import { getValidAccessToken, hasSlidesAccess } from '../../googleCredentials.js';
import { fetchJson } from '../http.js';

const API = 'https://slides.googleapis.com/v1/presentations';
const MAX_SLIDES = 15;
const MAX_BULLETS = 8;
const MAX_TITLE_CHARS = 150;
const MAX_BULLET_CHARS = 240;

class SlidesError extends Error {}

// The user's valid access token, or a SlidesError explaining what's missing.
async function slidesToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new SlidesError('Para crear presentaciones, inicia sesión con Google y pulsa "Conectar Google Slides" en Conectores.');
  if (!(await hasSlidesAccess(user.id))) throw new SlidesError('Google Slides no está conectado: pulsa "Conectar Google Slides" en el módulo Conectores.');
  try {
    return await getValidAccessToken(user.id);
  } catch (err) {
    throw new SlidesError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a conectar Google Slides.');
  }
}

async function slidesApi(token, path = '', options = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new SlidesError('Google rechazó el acceso a Google Slides. Vuelve a pulsar "Conectar Google Slides" en Conectores.');
  if (status === 403) throw new SlidesError('Google no permitió crear la presentación: revisa que la "Google Slides API" esté habilitada en tu proyecto de Google Cloud y que aceptaste el permiso de Slides.');
  if (status === 404) throw new SlidesError('No encuentro esa presentación.');
  if (status === 429) throw new SlidesError('Google Slides está limitando las solicitudes; inténtalo en un momento.');
  throw new SlidesError(data?.error?.message || 'Google Slides no respondió en este momento.');
}

// Wraps a tool body so a SlidesError becomes a readable { error }.
function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof SlidesError) return { error: err.message };
      throw err;
    }
  };
}

// One line of text: model output is data, so it is cleaned and cut.
const line = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The slides the model sent, cleaned. Empty ones are dropped; bullets may
// come as a list or as text with one bullet per line.
export function cleanSlides(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SlidesError('Las diapositivas deben ir en una lista.');
  return raw
    .slice(0, MAX_SLIDES)
    .map((s) => {
      const bullets = Array.isArray(s?.bullets) ? s.bullets : typeof s?.bullets === 'string' ? s.bullets.split('\n') : [];
      return {
        title: line(s?.title, MAX_TITLE_CHARS),
        bullets: bullets.map((b) => line(b, MAX_BULLET_CHARS)).filter(Boolean).slice(0, MAX_BULLETS),
      };
    })
    .filter((s) => s.title || s.bullets.length);
}

const newId = (prefix) => `${prefix}${randomUUID().replace(/-/g, '').slice(0, 16)}`;

// The batch that fills a new presentation: a cover (title and optional
// subtitle), one slide per entry, and the removal of the blank slide Google
// starts with. Every new slide gets its own ids, so each text goes into the
// placeholder it was created with, in the same batch.
export function buildRequests({ title, subtitle = '', slides = [], blankSlideId = null }, makeId = newId) {
  const requests = [];
  const coverTitle = makeId('ttl');
  const coverSubtitle = makeId('sub');
  requests.push({
    createSlide: {
      objectId: makeId('cov'),
      slideLayoutReference: { predefinedLayout: 'TITLE' },
      placeholderIdMappings: [
        { layoutPlaceholder: { type: 'CENTERED_TITLE' }, objectId: coverTitle },
        { layoutPlaceholder: { type: 'SUBTITLE' }, objectId: coverSubtitle },
      ],
    },
  });
  requests.push({ insertText: { objectId: coverTitle, text: title } });
  // An empty subtitle placeholder would show "Haz clic para añadir…" while editing.
  requests.push(subtitle ? { insertText: { objectId: coverSubtitle, text: subtitle } } : { deleteObject: { objectId: coverSubtitle } });

  for (const slide of slides) {
    const slideId = makeId('sld');
    const titleId = makeId('ttl');
    if (slide.bullets.length) {
      const bodyId = makeId('bdy');
      requests.push({
        createSlide: {
          objectId: slideId,
          slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
          placeholderIdMappings: [
            { layoutPlaceholder: { type: 'TITLE' }, objectId: titleId },
            { layoutPlaceholder: { type: 'BODY' }, objectId: bodyId },
          ],
        },
      });
      if (slide.title) requests.push({ insertText: { objectId: titleId, text: slide.title } });
      // One line per bullet: in the body placeholder, each line becomes a bullet.
      requests.push({ insertText: { objectId: bodyId, text: slide.bullets.join('\n') } });
    } else {
      requests.push({
        createSlide: {
          objectId: slideId,
          slideLayoutReference: { predefinedLayout: 'TITLE_ONLY' },
          placeholderIdMappings: [{ layoutPlaceholder: { type: 'TITLE' }, objectId: titleId }],
        },
      });
      requests.push({ insertText: { objectId: titleId, text: slide.title } });
    }
  }

  if (blankSlideId) requests.push({ deleteObject: { objectId: blankSlideId } });
  return requests;
}

// "Comprueba": reads the presentation back and counts its slides. true = all
// there, false = a different count, null = couldn't check (the writes still went through).
async function readBack(token, id, expected) {
  try {
    const found = await slidesApi(token, `/${encodeURIComponent(id)}?fields=slides.objectId`);
    return (found?.slides?.length ?? -1) === expected;
  } catch {
    return null;
  }
}

async function createPresentation(args, context) {
  const title = line(args.title, MAX_TITLE_CHARS);
  if (!title) return { error: 'La presentación necesita un título.' };
  const subtitle = line(args.subtitle, MAX_BULLET_CHARS);
  const content = cleanSlides(args.slides);
  const token = await slidesToken(context);

  const created = await slidesApi(token, '', { method: 'POST', body: JSON.stringify({ title }) });
  const id = created?.presentationId;
  if (!id) throw new SlidesError('Google Slides no devolvió la presentación.');
  const url = `https://docs.google.com/presentation/d/${id}/edit`;
  const expected = 1 + content.length;

  try {
    const requests = buildRequests({ title, subtitle, slides: content, blankSlideId: created.slides?.[0]?.objectId });
    await slidesApi(token, `/${encodeURIComponent(id)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
  } catch (err) {
    // The file exists already: say where it is, so the user isn't left guessing.
    return { error: `Creé «${title}» en tu Drive, pero no pude escribir sus diapositivas (${err.message}). Quedó vacía: ${url}` };
  }

  const verified = await readBack(token, id, expected);
  const count = `${expected} diapositiva${expected === 1 ? '' : 's'}`;
  const summary =
    verified === true
      ? `Creé «${title}» con ${count} en tu Drive. Comprobado: están todas. Enlace: ${url}`
      : verified === false
        ? `Creé «${title}» con ${count} en tu Drive, pero no pude comprobar todas: revísala. Enlace: ${url}`
        : `Creé «${title}» con ${count} en tu Drive. Enlace: ${url}`;
  return { created: true, id, url, title, slides: expected, verified, summary };
}

export default {
  id: 'slides',
  name: 'Google Slides',
  description: 'Eddie crea presentaciones en tu Drive, con título, subtítulo y diapositivas con viñetas, y te da el enlace para editarlas.',
  icon: 'doc',
  category: 'productividad',
  // Offered to the model only when the conversation touches the topic.
  route: /presentaci|diapositiv|slides?\b|powerpoint|google slides/i,
  auth: {
    type: 'google-login',
    scope: 'slides',
    isConnected: (user) => hasSlidesAccess(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Eddie crea presentaciones nuevas en tu Drive; no abre, edita ni borra las que ya tienes.',
  tools: [
    {
      label: 'Crear presentación',
      activity: 'Creando la presentación…',
      summarize: (result) => `${result.slides} diapositiva${result.slides === 1 ? '' : 's'} creada${result.slides === 1 ? '' : 's'}`,
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'create_presentation',
        description:
          'Crea una presentación nueva en el Google Slides del usuario (en su Drive) y devuelve el enlace para editarla. Úsala cuando pida una presentación, diapositivas o slides. Escribe el contenido tú: un título, un subtítulo opcional y las diapositivas en orden, cada una con su título y sus viñetas cortas, en el idioma del usuario. Después dile el enlace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Título de la presentación (portada).' },
            subtitle: { type: 'STRING', description: 'Subtítulo de la portada (opcional).' },
            slides: {
              type: 'ARRAY',
              description: `Las diapositivas en orden (hasta ${MAX_SLIDES}), sin contar la portada.`,
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING', description: 'Título de la diapositiva.' },
                  bullets: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                    description: `Viñetas cortas, una idea cada una (hasta ${MAX_BULLETS}).`,
                  },
                },
                required: ['title'],
              },
            },
          },
          required: ['title'],
        },
      },
      run: guarded(createPresentation),
    },
  ],
  webhook: null,
};
