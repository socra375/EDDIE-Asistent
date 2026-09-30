// The owner's GitHub: repositories, recent activity, issues and pull
// requests, plus creating issues and comments (always through the
// confirmation card). Eddie is a personal assistant, so this uses ONE token
// kept where every secret lives, in Vercel's environment (GITHUB_TOKEN); it
// never reaches the browser or the database. Because that token opens the
// owner's private repositories, the tools only work for a signed-in user
// whose Google email is listed in EDDIE_OWNER_EMAIL — anyone else who opens
// the app gets nothing.
import { clip, fetchJson } from '../http.js';

const API = 'https://api.github.com';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}(\/[A-Za-z0-9_.-]{1,100})?$/;
const MAX_TITLE = 200;
const MAX_BODY = 6000;
const LOGIN_TTL_MS = 10 * 60 * 1000;

class GithubError extends Error {}

export function ownerEmails(env = process.env) {
  return String(env.EDDIE_OWNER_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(user, env = process.env) {
  return Boolean(user?.email) && ownerEmails(env).includes(String(user.email).toLowerCase());
}

// The token, only for the signed-in owner.
async function ownerToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new GithubError('Para usar GitHub, inicia sesión con tu cuenta de Google (la del dueño de Eddie).');
  if (!isOwner(user)) throw new GithubError('GitHub solo está disponible para el dueño de Eddie (la cuenta de EDDIE_OWNER_EMAIL).');
  return process.env.GITHUB_TOKEN;
}

async function github(token, path, options = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new GithubError('GitHub rechazó el token: GITHUB_TOKEN no es válido o venció. Crea uno nuevo y actualízalo en Vercel.');
  if (status === 403 || status === 429) {
    throw new GithubError(/rate limit/i.test(data?.message || '') || status === 429 ? 'GitHub está limitando las solicitudes; inténtalo en unos minutos.' : 'El token no tiene permiso para esto en GitHub (revisa los permisos del token).');
  }
  if (status === 404) throw new GithubError('No encontré eso en GitHub: revisa el nombre del repositorio o que el token tenga acceso.');
  if (status === 410) throw new GithubError('Ese repositorio tiene los issues desactivados.');
  if (status === 422) throw new GithubError(`GitHub no aceptó la petición: ${clip(data?.message, 120) || 'datos no válidos'}.`);
  throw new GithubError('GitHub no respondió en este momento.');
}

// Wraps a tool body so a GithubError becomes a readable { error }.
function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof GithubError) return { error: err.message };
      throw err;
    }
  };
}

let loginCache = { token: '', login: '', at: 0 };
async function ownLogin(token) {
  if (loginCache.token === token && Date.now() - loginCache.at < LOGIN_TTL_MS) return loginCache.login;
  const me = await github(token, '/user');
  loginCache = { token, login: me?.login || '', at: Date.now() };
  return loginCache.login;
}

// "owner/name", or just "name" for one of the token owner's own repos.
async function resolveRepo(token, value) {
  const repo = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!REPO_RE.test(repo)) throw new GithubError('Indica el repositorio como "dueño/nombre" (por ejemplo "socra375/EDDIE-Asistent") o solo el nombre.');
  if (repo.includes('/')) return repo;
  const login = await ownLogin(token);
  if (!login) throw new GithubError('No pude saber tu usuario de GitHub; indica el repositorio como "dueño/nombre".');
  return `${login}/${repo}`;
}

const day = (iso) => String(iso || '').slice(0, 10);
const firstLine = (s) => String(s || '').split('\n')[0];

function issueSummary(i) {
  return { numero: i.number, titulo: clip(i.title, 100), autor: i.user?.login, etiquetas: (i.labels || []).map((l) => l.name).slice(0, 4), actualizado: day(i.updated_at) };
}

// ---- Read tools ----

async function listRepos(args, context) {
  const token = await ownerToken(context);
  const repos = await github(token, '/user/repos?sort=pushed&direction=desc&per_page=8&affiliation=owner,collaborator');
  return {
    repos: (repos || []).map((r) => ({
      repo: r.full_name,
      privado: r.private,
      lenguaje: r.language || undefined,
      descripcion: clip(r.description, 80) || undefined,
      ultimo_push: day(r.pushed_at),
      issues_abiertos: r.open_issues_count,
    })),
  };
}

// CI state of the default branch from its check runs; absent if unreadable.
async function ciState(token, repo, branch) {
  try {
    const data = await github(token, `/repos/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=30`);
    const runs = data?.check_runs || [];
    if (!runs.length) return 'sin verificaciones';
    if (runs.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion))) return 'falla';
    if (runs.some((r) => r.status !== 'completed')) return 'en curso';
    return 'correcto';
  } catch {
    return undefined;
  }
}

async function repoActivity(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const [info, commits, pulls, issues] = await Promise.all([
    github(token, `/repos/${repo}`),
    github(token, `/repos/${repo}/commits?per_page=5`),
    github(token, `/repos/${repo}/pulls?state=open&per_page=5`),
    github(token, `/repos/${repo}/issues?state=open&per_page=10`),
  ]);
  const ci = await ciState(token, repo, info.default_branch);
  return {
    repo: info.full_name,
    descripcion: clip(info.description, 120) || undefined,
    privado: info.private,
    lenguaje: info.language || undefined,
    rama_principal: info.default_branch,
    ultimo_push: day(info.pushed_at),
    ci_rama_principal: ci,
    ultimos_commits: (commits || []).map((c) => ({ fecha: day(c.commit?.author?.date), autor: c.commit?.author?.name, mensaje: clip(firstLine(c.commit?.message), 90) })),
    prs_abiertos: (pulls || []).map(issueSummary),
    issues_abiertos: (issues || []).filter((i) => !i.pull_request).slice(0, 5).map(issueSummary),
    nota: 'Si esto actualiza el estado de un proyecto de la memoria, ofrece guardarlo con update_project (último cambio, próximo objetivo).',
  };
}

async function listIssues(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
  const kind = ['issue', 'pr', 'all'].includes(args.kind) ? args.kind : 'all';
  const items = await github(token, `/repos/${repo}/issues?state=${state}&per_page=20&sort=updated`);
  const picked = (items || []).filter((i) => (kind === 'all' ? true : kind === 'pr' ? Boolean(i.pull_request) : !i.pull_request)).slice(0, 10);
  return { repo, estado: state, total: picked.length, items: picked.map((i) => ({ ...issueSummary(i), tipo: i.pull_request ? 'PR' : 'issue', estado: i.state })) };
}

async function getIssue(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const n = args.number;
  if (!Number.isInteger(n) || n < 1) throw new GithubError('Indica el número del issue o PR.');
  const issue = await github(token, `/repos/${repo}/issues/${n}`);
  const out = {
    repo,
    numero: issue.number,
    tipo: issue.pull_request ? 'PR' : 'issue',
    titulo: clip(issue.title, 140),
    estado: issue.state,
    autor: issue.user?.login,
    etiquetas: (issue.labels || []).map((l) => l.name).slice(0, 6),
    descripcion: clip(issue.body, 1200) || undefined,
    comentarios: issue.comments,
    actualizado: day(issue.updated_at),
    enlace: issue.html_url,
  };
  if (issue.pull_request) {
    try {
      const pr = await github(token, `/repos/${repo}/pulls/${n}`);
      Object.assign(out, { fusionado: pr.merged, se_puede_fusionar: pr.mergeable ?? undefined, rama: `${pr.head?.ref} → ${pr.base?.ref}`, cambios: `${pr.changed_files} archivos, +${pr.additions} −${pr.deletions}` });
    } catch {
      // The PR details are a bonus; the issue data above already answers.
    }
  }
  if (issue.comments > 0) {
    const comments = await github(token, `/repos/${repo}/issues/${n}/comments?per_page=5`);
    out.ultimos_comentarios = (comments || []).map((c) => ({ autor: c.user?.login, fecha: day(c.created_at), texto: clip(c.body, 300) }));
  }
  return out;
}

// ---- Write tools (confirmation card) ----

function cleanText(value, max) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

async function prepareIssue(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const title = cleanText(args.title, MAX_TITLE).replace(/\s+/g, ' ');
  if (!title) return { error: 'El issue necesita un título.' };
  const body = cleanText(args.body, MAX_BODY);
  return {
    args: { repo, title, body },
    preview: {
      title: 'Crear issue en GitHub',
      confirmLabel: 'Crear',
      fields: [
        { key: 'repo', label: 'Repositorio', value: repo },
        { key: 'title', label: 'Título', value: title, editable: true },
        { key: 'body', label: 'Descripción', value: body, editable: true, multiline: true },
      ],
    },
  };
}

async function createIssue(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const title = cleanText(args.title, MAX_TITLE).replace(/\s+/g, ' ');
  if (!title) throw new GithubError('El issue necesita un título.');
  const created = await github(token, `/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body: cleanText(args.body, MAX_BODY) }) });
  // GitHub answers with the stored issue: comparing it is the read-back.
  const verified = Boolean(created?.number) && created.title === title;
  return {
    created: true,
    repo,
    numero: created?.number,
    enlace: created?.html_url,
    verified,
    summary: verified ? `Issue #${created.number} creado en ${repo}. Comprobado en GitHub.` : `Pedí crear el issue en ${repo}, pero no pude comprobar que quedó: revísalo en GitHub.`,
  };
}

async function prepareComment(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const n = args.number;
  if (!Number.isInteger(n) || n < 1) return { error: 'Indica el número del issue o PR.' };
  const body = cleanText(args.body, MAX_BODY);
  if (!body) return { error: 'El comentario está vacío.' };
  const issue = await github(token, `/repos/${repo}/issues/${n}`);
  return {
    args: { repo, number: n, body },
    preview: {
      title: `Comentar en ${issue.pull_request ? 'el PR' : 'el issue'} #${n}`,
      confirmLabel: 'Comentar',
      fields: [
        { key: 'repo', label: 'Repositorio', value: repo },
        { key: 'issue', label: issue.pull_request ? 'PR' : 'Issue', value: `#${n} ${clip(issue.title, 80)}` },
        { key: 'body', label: 'Comentario', value: body, editable: true, multiline: true },
      ],
    },
  };
}

async function comment(args, context) {
  const token = await ownerToken(context);
  const repo = await resolveRepo(token, args.repo);
  const body = cleanText(args.body, MAX_BODY);
  if (!body) throw new GithubError('El comentario está vacío.');
  const created = await github(token, `/repos/${repo}/issues/${args.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  const verified = Boolean(created?.id) && created.body === body;
  return {
    commented: true,
    repo,
    numero: args.number,
    enlace: created?.html_url,
    verified,
    summary: verified ? `Comentario publicado en ${repo}#${args.number}. Comprobado en GitHub.` : `Pedí publicar el comentario en ${repo}#${args.number}, pero no pude comprobarlo: revísalo en GitHub.`,
  };
}

const REPO_PARAM = {
  type: 'STRING',
  description: 'Repositorio como "dueño/nombre" o solo el nombre si es del usuario. Si habla de un proyecto de la memoria con repo, usa ese.',
};

export default {
  id: 'github',
  name: 'GitHub',
  description: 'Eddie mira tus repositorios, su actividad reciente, issues y pull requests; crea issues y comentarios con tu confirmación.',
  icon: 'github',
  category: 'comunicacion',
  // Offered to the model only when the conversation touches the topic.
  route: /github|\brepos?\b|repositorio|commit|pull request|\bprs?\b|issue|\bci\b|\brama\b|\bbranch|merge|fusi[oó]n|deploy|despliegue/i,
  auth: {
    type: 'google-login',
    isConnected: (user) => isOwner(user),
  },
  requiredEnv: ['GITHUB_TOKEN', 'EDDIE_OWNER_EMAIL'],
  note: 'Solo el dueño de Eddie (la cuenta de Google de EDDIE_OWNER_EMAIL) puede usarlo. Eddie nunca crea issues ni comentarios sin que lo confirmes; no fusiona ni borra nada.',
  tools: [
    {
      label: 'Ver tus repositorios',
      activity: 'Consultando GitHub…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.repos.length} repositorios recientes`,
      declaration: {
        name: 'github_list_repos',
        description: 'Lista los repositorios de GitHub del usuario con actividad más reciente.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: guarded(listRepos),
    },
    {
      label: 'Ver la actividad de un repositorio',
      activity: 'Revisando el repositorio…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.repo}: ${r.ultimos_commits.length} commits recientes, ${r.prs_abiertos.length} PR abiertos${r.ci_rama_principal ? `, CI ${r.ci_rama_principal}` : ''}`,
      declaration: {
        name: 'github_repo_activity',
        description: 'Resume un repositorio: últimos commits, PR e issues abiertos y estado del CI. Úsala para "¿cómo va mi proyecto X?".',
        parameters: { type: 'OBJECT', properties: { repo: REPO_PARAM }, required: ['repo'] },
      },
      run: guarded(repoActivity),
    },
    {
      label: 'Listar issues y PR',
      activity: 'Buscando issues…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.total} en ${r.repo}`,
      declaration: {
        name: 'github_list_issues',
        description: 'Lista issues y/o pull requests de un repositorio.',
        parameters: {
          type: 'OBJECT',
          properties: {
            repo: REPO_PARAM,
            state: { type: 'STRING', enum: ['open', 'closed', 'all'], description: 'Por defecto open.' },
            kind: { type: 'STRING', enum: ['issue', 'pr', 'all'], description: 'Por defecto all.' },
          },
          required: ['repo'],
        },
      },
      run: guarded(listIssues),
    },
    {
      label: 'Leer un issue o PR',
      activity: 'Leyendo el issue…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.tipo} #${r.numero}: ${r.titulo}`,
      declaration: {
        name: 'github_get_issue',
        description: 'Lee un issue o pull request por su número: descripción, estado, cambios y últimos comentarios.',
        parameters: { type: 'OBJECT', properties: { repo: REPO_PARAM, number: { type: 'INTEGER', description: 'Número del issue o PR.' } }, required: ['repo', 'number'] },
      },
      run: guarded(getIssue),
    },
    {
      label: 'Crear un issue',
      activity: 'Preparando el issue…',
      sensitive: true,
      declaration: {
        name: 'github_create_issue',
        description: 'Crea un issue en un repositorio. Siempre pide confirmación con una tarjeta; tú solo lo propones.',
        parameters: {
          type: 'OBJECT',
          properties: { repo: REPO_PARAM, title: { type: 'STRING', description: 'Título corto.' }, body: { type: 'STRING', description: 'Descripción en texto plano o Markdown.' } },
          required: ['repo', 'title'],
        },
      },
      prepare: guarded(prepareIssue),
      run: guarded(createIssue),
    },
    {
      label: 'Comentar en un issue o PR',
      activity: 'Preparando el comentario…',
      sensitive: true,
      declaration: {
        name: 'github_comment',
        description: 'Publica un comentario en un issue o PR. Siempre pide confirmación con una tarjeta; tú solo lo propones.',
        parameters: {
          type: 'OBJECT',
          properties: { repo: REPO_PARAM, number: { type: 'INTEGER', description: 'Número del issue o PR.' }, body: { type: 'STRING', description: 'El comentario.' } },
          required: ['repo', 'number', 'body'],
        },
      },
      prepare: guarded(prepareComment),
      run: guarded(comment),
    },
  ],
  webhook: null,
};
