// /api/connectors/construction3d — the 3D brain, for the Construction 3D screen:
//   GET  construction3d                 the user's projects, the limits and what is in use
//   POST construction3d/upload { name, bytes }   makes the row and a short-lived URL to PUT the model to (.glb, .stl or .obj)
//   POST construction3d/complete { id } checks what arrived (size, "glTF" header) and publishes it
//   GET  construction3d/url?id=…        a short-lived URL to read the model (only the owner's) and its format
//   POST construction3d/update { id, name?, status?, notes? }
//   POST construction3d/delete { id }
// The file never passes through this server (Vercel caps a request near 4.5 MB):
// the browser talks to the private bucket with the URLs minted here.
import { randomUUID } from 'node:crypto';
import { requireUser } from '../session.js';
import { allowedOrigins } from '../requestGuard.js';
import { limiterFor } from '../rateLimit.js';
import { deleteObject, ensureBucketCors, headObject, missingS3Env, presign, readHead } from './s3.js';
import { WHAT_TO_EXPORT, contentTypeOf, formatOf, looksLikeModel } from './format.js';
import { MAX_MODEL_BYTES, MAX_PROJECTS, MAX_TOTAL_BYTES, STATUSES, createProject, deleteProject, getProject, listProjects, markReady, projectUsage, takeStaleUploads, updateProject } from './store.js';

const UUID = /^[0-9a-f-]{36}$/i;
const URL_SECONDS = 600;

const missingEnv = () => [...(process.env.DATABASE_URL ? [] : ['DATABASE_URL']), ...missingS3Env()];
const clean = (value, max) => String(value ?? '').replace(/[\p{Cc}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const noStore = { 'Cache-Control': 'private, no-store' };
const bad = (status, error, extra = {}) => ({ status, json: { error, ...extra } });

async function limits(userId) {
  const usage = await projectUsage(userId);
  return { count: usage.count, bytes: usage.bytes, maxProjects: MAX_PROJECTS, maxBytes: MAX_TOTAL_BYTES, maxModelBytes: MAX_MODEL_BYTES };
}

// The address the browser will upload from: its own, when it is Eddie's page.
function pageOrigin(headers = {}) {
  try {
    const origin = new URL(String(headers.origin || '')).origin;
    if (headers['sec-fetch-site'] === 'same-origin' || allowedOrigins().has(origin)) return origin;
  } catch {
    // no usable Origin header
  }
  return [...allowedOrigins()][0] || '';
}

async function dropObjects(keys) {
  await Promise.all(keys.map((key) => deleteObject(key).catch(() => {})));
}

async function upload(user, body, headers) {
  if (!limiterFor('construction3d-upload', 20)(`u:${user.id}`).ok) return bad(429, 'Demasiadas subidas seguidas. Espera un momento.');
  const format = formatOf(body?.name);
  if (!format) return bad(400, 'Sube un archivo .glb, .stl o .obj.');
  const bytes = Number(body?.bytes);
  if (!Number.isInteger(bytes) || bytes < 20) return bad(400, 'No pude saber el tamaño del archivo.');
  if (bytes > MAX_MODEL_BYTES) return bad(413, `Ese modelo pesa demasiado: el máximo es ${Math.round(MAX_MODEL_BYTES / 1048576)} MB.`);
  await dropObjects(await takeStaleUploads(user.id));
  const usage = await projectUsage(user.id);
  if (usage.count >= MAX_PROJECTS) return bad(409, `Ya tienes ${MAX_PROJECTS} proyectos. Borra alguno para hacer espacio.`);
  if (usage.bytes + bytes > MAX_TOTAL_BYTES) return bad(409, 'El cerebro 3D está lleno. Borra algún proyecto para hacer espacio.');
  // Best effort: when it fails the upload below fails with a clear browser error, and the user is told why.
  const corsOk = await ensureBucketCors(pageOrigin(headers)).catch(() => false);
  const name = clean(body?.name, 80).replace(/\.(glb|stl|obj)$/i, '') || 'Proyecto sin nombre';
  const key = `u/${user.id}/${randomUUID()}.${format}`;
  const contentType = contentTypeOf(format);
  const project = await createProject(user.id, { name, bytes, key });
  return {
    status: 200,
    headers: noStore,
    json: { id: project.id, name: project.name, uploadUrl: presign('PUT', key, { expires: URL_SECONDS, headers: { 'content-type': contentType } }), headers: { 'Content-Type': contentType }, corsOk },
  };
}

async function complete(user, body) {
  if (!UUID.test(String(body?.id || ''))) return bad(400, 'Indica el proyecto.');
  const project = await getProject(user.id, body.id);
  if (!project) return bad(404, 'Ese proyecto ya no existe.');
  if (project.ready) return { status: 200, json: { item: project, limits: await limits(user.id) } };
  const reject = async (status, error) => {
    await deleteProject(user.id, project.id);
    await dropObjects([project.key]);
    return bad(status, error);
  };
  const stored = await headObject(project.key);
  if (!stored) return reject(409, 'El archivo no llegó completo al almacenamiento. Inténtalo de nuevo.');
  if (stored.bytes > MAX_MODEL_BYTES) return reject(413, 'Ese modelo pesa demasiado.');
  const format = formatOf(project.key);
  if (!looksLikeModel(format, await readHead(project.key, 4096), stored.bytes)) return reject(422, `Ese archivo no es un modelo ${format.toUpperCase()} válido. ${WHAT_TO_EXPORT[format]}`);
  return { status: 200, json: { item: await markReady(user.id, project.id, stored.bytes), limits: await limits(user.id) } };
}

export async function handleConstruction3dRoute({ method, path = [], cookies = {}, query = {}, headers = {}, body }) {
  const user = await requireUser(cookies);
  const sub = path[1];
  const missing = missingEnv();

  if (!sub && method === 'GET') {
    if (missing.length) return { status: 200, json: { configured: false, missing, items: [] } };
    return { status: 200, headers: noStore, json: { configured: true, items: await listProjects(user.id), limits: await limits(user.id) } };
  }
  if (missing.length) return bad(503, `Falta configurar en Vercel: ${missing.join(', ')}.`);

  if (sub === 'upload' && method === 'POST') return upload(user, body, headers);
  if (sub === 'complete' && method === 'POST') return complete(user, body);
  if (sub === 'url' && method === 'GET') {
    if (!UUID.test(String(query.id || ''))) return bad(400, 'Indica el proyecto.');
    const project = await getProject(user.id, query.id);
    if (!project?.ready) return bad(404, 'Ese proyecto ya no existe.');
    return { status: 200, headers: noStore, json: { url: presign('GET', project.key, { expires: URL_SECONDS }), format: formatOf(project.key), expiresIn: URL_SECONDS } };
  }
  if (sub === 'update' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return bad(400, 'Indica el proyecto.');
    if (body.status !== undefined && !STATUSES.includes(body.status)) return bad(400, 'Estado no válido.');
    const name = body.name === undefined ? undefined : clean(body.name, 80);
    if (name === '') return bad(400, 'El nombre no puede quedar vacío.');
    const notes = body.notes === undefined ? undefined : clean(body.notes, 500);
    const item = await updateProject(user.id, body.id, { name, status: body.status, notes });
    return item ? { status: 200, json: { item } } : bad(404, 'Ese proyecto ya no existe.');
  }
  if (sub === 'delete' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return bad(400, 'Indica el proyecto.');
    const key = await deleteProject(user.id, body.id);
    if (!key) return bad(404, 'Ese proyecto ya no existe.');
    await dropObjects([key]);
    return { status: 200, json: { ok: true, limits: await limits(user.id) } };
  }
  return bad(404, 'Esa acción de Construction 3D no existe.');
}
