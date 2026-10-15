// Eddie's marketing hand: ideas, scripts and captions in the user's own voice,
// and video editing on the user's PC with ffmpeg (free) through EDDIE Prime:
// trim, join, vertical 9:16, text on screen, background music, a lighter file.
// Eddie edits what the user already has; he does not record, generate footage
// or publish anything. Every edit makes a NEW file in Videos/Eddie and asks for
// confirmation first (it uses the PC and writes a file). Not a separate AI:
// the same Eddie, with the business brain (voice, context, prices) as brief.
import { listBusiness } from '../../business/store.js';
import { areaOf } from '../../../../src/services/business.js';
import { devicesByUser } from '../../computer/store.js';
import { pickDevice, resolveTool, runOnDevice } from '../../computer/run.js';
import { clip } from '../http.js';

const MIN_AGENT = '1.9.0';
const MIN_AGENT_REEL = '1.10.0';
const versionAtLeast = (version, min) => {
  const a = String(version || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true;
};
const BRIEF_AREAS = ['estilo', 'contexto', 'precios', 'clientes'];
const PLATFORMS = ['reels', 'tiktok', 'shorts', 'instagram', 'facebook', 'whatsapp', 'youtube', 'otro'];

const OPERATIONS = {
  trim: 'Recortar',
  join: 'Unir dos videos',
  vertical: 'Pasar a vertical 9:16',
  caption: 'Poner un texto',
  music: 'Añadir música',
  compress: 'Aligerar el archivo',
  reel: 'Hacer un reel (vertical, texto y música)',
};

const getUser = async (context) => context.getUser?.();

// What each kind of video needs (shape and structure only; no platform limits
// that change from month to month).
const FORMATS = {
  vertical: 'Vertical 9:16 (1080x1920), de 15 a 45 segundos, gancho en los primeros 2 segundos, texto en pantalla porque muchos lo ven sin sonido.',
  feed: 'Para el feed: cuadrado o 4:5, corto, con el mensaje claro en la primera imagen.',
  horizontal: 'Horizontal 16:9; el gancho en los primeros 5 segundos y una miniatura con poco texto.',
  whatsapp: 'Estado o mensaje de WhatsApp: vertical, corto (menos de 30 segundos) y ligero; si pesa mucho, usa compress.',
};
const FORMAT_OF = { reels: 'vertical', tiktok: 'vertical', shorts: 'vertical', instagram: 'feed', facebook: 'feed', whatsapp: 'whatsapp', youtube: 'horizontal' };

// The business brain as marketing context: how the user talks, what the business is, what it charges.
async function businessContext(user) {
  if (!user) return null;
  const nodes = (await listBusiness(user.id)).filter((n) => BRIEF_AREAS.includes(n.area));
  const order = (n) => BRIEF_AREAS.indexOf(n.area);
  return nodes
    .sort((a, b) => order(a) - order(b))
    .slice(0, 12)
    .map((n) => ({ area: areaOf(n.area)?.label, title: n.title, summary: clip(n.summary, 160), ...(n.amount != null ? { amount: n.amount } : {}), last_note: clip(n.notes?.at(-1)?.text, 160) || undefined }));
}

async function brief(args, context) {
  const goal = clip(args.goal, 300);
  if (!goal) return { error: 'Dime qué se quiere promocionar (el negocio, un producto, una oferta).' };
  const platform = PLATFORMS.includes(args.platform) ? args.platform : 'otro';
  const user = await getUser(context);
  const business = await businessContext(user);
  return {
    goal,
    platform,
    format: FORMATS[FORMAT_OF[platform]] || 'Elige el formato según dónde se publique; si dudas, vertical y corto.',
    business: business?.length ? business : null,
    structure: ['Gancho (0 a 2 s): una frase que pare el dedo', 'Problema o promesa', 'Prueba o demostración', 'Llamado a la acción claro (qué hacer y dónde)'],
    deliver: ['Guion con tiempos', 'Texto en pantalla por escena (corto)', 'Descripción con 5 a 8 hashtags', 'Qué video suyo usar y qué ediciones hacerle'],
    video_flow: 'Mira sus videos con video_info; edítalos con edit_video (trim, vertical, caption, music, join, compress). Cada paso crea un video NUEVO en Videos/Eddie: para el siguiente paso usa ese archivo. Pregunta cómo va con video_status si tarda.',
    rules: [
      'Habla con la voz del usuario (el área «Cómo hablo»), no con la tuya.',
      'No inventes precios, descuentos, fechas ni resultados: usa solo lo guardado o pregunta.',
      'Música: solo la que el usuario tenga o tenga licencia; una canción comercial puede bloquear el video.',
      'Eddie no graba ni genera imágenes de video ni publica por el usuario: entrega el video y el texto para que él lo suba.',
    ],
    note: business?.length ? undefined : 'No hay datos del negocio guardados: pregunta lo básico (qué vende, a quién, tono) y guárdalo con save_business.',
  };
}

// The user's computer and the video tool, or an error the model can act on. An agent older than 1.9.0
// has no video tools: say how to update instead of listing tools it does not have.
async function videoTool(user, name, given, risk, { minVersion = MIN_AGENT } = {}) {
  if (!user) return { error: 'Para editar videos en tu PC, inicia sesión con tu cuenta de Google.' };
  const picked = pickDevice(await devicesByUser(user.id), given?.device);
  if (picked.error) return picked;
  if (!picked.device.tools.some((t) => t.name === name) || !versionAtLeast(picked.device.version, minVersion)) {
    return {
      error: `El agente EDDIE Prime de «${picked.device.name}» (versión ${picked.device.version || 'antigua'}) todavía no hace eso: hace falta la ${minVersion} o más nueva. En Windows, vuelve a descargar el instalador en Conectores → Tu equipo (EDDIE Prime) y ejecútalo; en Linux o Mac, vuelve a descargar eddie_agent.py.`,
    };
  }
  return resolveTool(user, name, given, { risk });
}

const summaryOf = (result) => (result && typeof result.summary === 'string' ? result.summary : '');

function forModel(outcome, resolved) {
  if (outcome.error) return { error: outcome.error };
  const result = outcome.result;
  return {
    device: resolved.device.name,
    result,
    summary: summaryOf(result),
    ...(result?.estado === 'editando' ? { note: 'Sigue editando. Dile al usuario que tarda un poco y ofrécele revisar con video_status.' } : {}),
    ...(result?.estado === 'listo' ? { note: 'El video nuevo quedó en esa carpeta del PC; el original no se tocó. Dile cómo se llama el archivo.' } : {}),
  };
}

const DEVICE_ARG = { type: 'STRING', description: 'Nombre del equipo (o "windows"…). Solo si el usuario tiene varios equipos vinculados.' };

export default {
  id: 'marketing',
  // A specialist: when a request touches two of these, Eddie hands each its part (see delegation/).
  role: { name: 'Marketing', does: 'los videos y el contenido: cortar, unir, subtitular, reels, guiones y marca' },
  name: 'Marketing y videos',
  description:
    'Eddie piensa tu contenido (guion, texto en pantalla, descripción y hashtags con tu voz y los datos de tu negocio) y edita tus videos en tu PC con ffmpeg, gratis: recortar, unir, pasar a vertical para Reels y TikTok, poner texto, añadir música y aligerar el archivo. No graba ni publica por ti.',
  icon: 'play',
  category: 'asistente',
  route:
    /marketing|publicidad|promoci[oó]n|promocionar|anuncio|\breels?\b|tiktok|\bshorts?\b|instagram|contenido para|publicaci[oó]n|hashtags?|gui[oó]n|campa[ñn]a|(edit|recort|une|unir|junta|pon|ponle|a[ñn]ade|a[ñn]adele|agrega|pasa|convierte|aligera|comprime)\w*.*(video|v[ií]deo|clip)|(video|v[ií]deo|clip).*(vertical|subt[ií]tul|m[uú]sica|recort|edit|texto|peso|pesa|ligero)|ffmpeg/i,
  guide: `MARKETING Y VIDEOS — cómo y cuándo:
1. Antes de escribir un guion, anuncio o publicación llama a marketing_brief (con la plataforma si la dijo). Escribe con la voz del usuario y solo con los datos reales de su negocio: nunca inventes precios, ofertas ni resultados.
2. Entrega siempre listo para usar: gancho (primeros 2 s), guion con tiempos, texto en pantalla por escena, descripción con 5 a 8 hashtags y el llamado a la acción.
3. Si ya tiene el video: video_info para hallar el archivo exacto. Para un Reel, TikTok o Short usa make_reel (recorta, vertical, texto y música en un solo paso, una sola tarjeta). Para un arreglo suelto usa edit_video. Cada edición crea un archivo nuevo; para encadenar usa el que dejó la anterior.
4. Si tarda, dile que sigue y mira video_status cuando pregunte; no repitas la orden.
5. Si el equipo no responde, falta ffmpeg o el agente es viejo, dilo en una frase con qué hacer y no insistas.
6. No publicas por él ni prometes resultados. Si pide un plan semanal, ofrécele crear una tarea por publicación (create_task).`,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Edita en tu PC, así que necesita el agente EDDIE Prime (versión 1.9.0 o más nueva) y ffmpeg instalado (gratis; Eddie te dice cómo si falta). Cada edición crea un video nuevo en Videos/Eddie —el original no se toca— y pide tu confirmación. Solo con archivos de tu carpeta personal. No graba, no genera imágenes de video y no publica.',
  tools: [
    {
      label: 'Preparar contenido de marketing',
      activity: 'Armando el material de marketing…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : `Marketing: ${clip(result?.goal, 80)}`),
      declaration: {
        name: 'marketing_brief',
        description:
          'Úsala ANTES de escribir un guion, un anuncio, una publicación o de editar un video para promocionar algo: devuelve cómo habla el usuario, su negocio y sus precios (de su cerebro de Negocios), el formato que pide la plataforma, la estructura del contenido y las reglas. Después escribe el material con esos datos y, si hay un video suyo, edítalo con edit_video.',
        parameters: {
          type: 'OBJECT',
          properties: {
            goal: { type: 'STRING', description: 'Qué se promociona o qué debe lograr el contenido, en una frase.' },
            platform: { type: 'STRING', enum: PLATFORMS, description: 'Dónde se publicará (reels, tiktok, shorts, instagram, facebook, whatsapp, youtube).' },
          },
          required: ['goal'],
        },
      },
      run: (args, context) => brief(args, context),
    },
    {
      label: 'Ver tus videos',
      activity: 'Mirando tus videos…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(summaryOf(result?.result), 120)),
      declaration: {
        name: 'video_info',
        description:
          'Mira los videos del PC del usuario con ffmpeg: sin path, dice si ffmpeg está instalado y lista sus videos recientes (Videos, Descargas, Escritorio…); con path (nombre como «clip.mp4» o ruta como «Videos/clip.mp4»), dice duración, tamaño de imagen y si trae audio. Úsala para encontrar el archivo exacto antes de editar.',
        parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Nombre o ruta del video o audio (opcional).' }, device: DEVICE_ARG } },
      },
      run: async (args, context) => {
        const resolved = await videoTool(await getUser(context), 'video_info', args, 'read');
        if (resolved.error) return { error: resolved.error };
        return forModel(await runOnDevice(resolved.device, resolved.tool, resolved.args), resolved);
      },
    },
    {
      label: 'Editar un video',
      activity: 'Preparando la edición del video…',
      sensitive: true,
      summarize: (result) => (result?.error ? undefined : clip(result?.summary, 120)),
      declaration: {
        name: 'edit_video',
        description:
          'Edita un video del usuario en su PC con ffmpeg. Crea un video NUEVO en Videos/Eddie; el original no se toca. operation: trim (recortar; start y end, ej. "0:05" y "0:20"), join (unir path + second), vertical (pasar a 9:16 para Reels, TikTok y Shorts), caption (poner text en pantalla, opcional start y end), music (añadir el audio second de fondo, bajito) o compress (aligerar el archivo para mandarlo). Para varias ediciones, hazlas una por una: cada una usa el archivo que dejó la anterior. Pide confirmación con una tarjeta. Si no sabes el nombre exacto del archivo, usa video_info primero.',
        parameters: {
          type: 'OBJECT',
          properties: {
            operation: { type: 'STRING', enum: Object.keys(OPERATIONS), description: 'trim, join, vertical, caption, music o compress.' },
            path: { type: 'STRING', description: 'El video a editar: nombre («clip.mp4») o ruta («Videos/clip.mp4»).' },
            second: { type: 'STRING', description: 'join: el segundo video. music: el audio (mp3, wav…).' },
            start: { type: 'STRING', description: 'trim y caption: dónde empieza (segundos o minutos:segundos, ej. 1:30).' },
            end: { type: 'STRING', description: 'trim y caption: dónde termina (ej. 0:45).' },
            text: { type: 'STRING', description: 'caption: el texto que se verá (corto, máx. 200 caracteres).' },
            device: DEVICE_ARG,
          },
          required: ['operation', 'path'],
        },
      },
      prepare: async (args, context) => {
        const resolved = await videoTool(await getUser(context), 'edit_video', args, 'confirm');
        if (resolved.error) return { error: resolved.error };
        const a = resolved.args;
        const fields = [
          { key: 'device', label: 'Equipo', value: resolved.device.name },
          { key: 'operation', label: 'Edición', value: OPERATIONS[a.operation] || a.operation },
          { key: 'path', label: 'Video', value: a.path },
          ...(a.second ? [{ key: 'second', label: a.operation === 'music' ? 'Música' : 'Segundo video', value: a.second }] : []),
          ...(a.start ? [{ key: 'start', label: 'Desde', value: a.start }] : []),
          ...(a.end ? [{ key: 'end', label: 'Hasta', value: a.end }] : []),
          ...(a.text ? [{ key: 'text', label: 'Texto', value: a.text, editable: true }] : []),
          { key: 'nota', label: 'Nota', value: 'Crea un video nuevo en Videos/Eddie; el original no se toca.' },
        ];
        return {
          // `device` travels with the card, as in computer_action, so confirming does not re-ask which PC.
          args: { ...a, device: resolved.device.name },
          preview: { title: `${OPERATIONS[a.operation] || 'Editar video'} en ${resolved.device.name}`, confirmLabel: 'Editar', fields },
        };
      },
      run: async (args, context) => {
        const resolved = await videoTool(await getUser(context), 'edit_video', args, 'confirm');
        if (resolved.error) return { error: resolved.error };
        return forModel(await runOnDevice(resolved.device, resolved.tool, resolved.args), resolved);
      },
    },
    {
      label: 'Hacer un reel',
      activity: 'Preparando el reel…',
      sensitive: true,
      summarize: (result) => (result?.error ? undefined : clip(result?.summary, 120)),
      declaration: {
        name: 'make_reel',
        description:
          'Convierte un video del usuario en un Reel / TikTok / Short EN UN SOLO PASO, en su PC: recorta el tramo que sirve (start y end, opcionales), lo pasa a vertical 9:16, le pone el texto en pantalla (text, opcional) y le añade música de fondo (music, opcional). Crea un video NUEVO en Videos/Eddie; el original no se toca. Úsala en vez de encadenar recortar + vertical + texto + música. Pide confirmación con una tarjeta. Si no sabes el nombre exacto del archivo, usa video_info primero.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'El video: nombre («clip.mp4») o ruta («Videos/clip.mp4»).' },
            start: { type: 'STRING', description: 'Dónde empieza el tramo (segundos o minutos:segundos). Opcional.' },
            end: { type: 'STRING', description: 'Dónde termina el tramo. Opcional.' },
            text: { type: 'STRING', description: 'Texto en pantalla (gancho corto, máx. 200 caracteres). Opcional.' },
            music: { type: 'STRING', description: 'Audio de fondo (mp3, wav…): nombre o ruta. Opcional; solo música que el usuario pueda usar.' },
            device: DEVICE_ARG,
          },
          required: ['path'],
        },
      },
      prepare: async (args, context) => {
        const given = { operation: 'reel', path: args.path, start: args.start, end: args.end, text: args.text, second: args.music, device: args.device };
        const resolved = await videoTool(await getUser(context), 'edit_video', given, 'confirm', { minVersion: MIN_AGENT_REEL });
        if (resolved.error) return { error: resolved.error };
        const a = resolved.args;
        const fields = [
          { key: 'device', label: 'Equipo', value: resolved.device.name },
          { key: 'edit', label: 'Edición', value: OPERATIONS.reel },
          { key: 'path', label: 'Video', value: a.path },
          ...(a.start ? [{ key: 'start', label: 'Desde', value: a.start }] : []),
          ...(a.end ? [{ key: 'end', label: 'Hasta', value: a.end }] : []),
          ...(a.text ? [{ key: 'text', label: 'Texto', value: a.text, editable: true }] : []),
          ...(a.second ? [{ key: 'music', label: 'Música', value: a.second }] : []),
          { key: 'nota', label: 'Nota', value: 'Crea un video nuevo en Videos/Eddie; el original no se toca.' },
        ];
        return {
          args: { path: a.path, ...(a.start ? { start: a.start } : {}), ...(a.end ? { end: a.end } : {}), ...(a.text ? { text: a.text } : {}), ...(a.second ? { music: a.second } : {}), device: resolved.device.name },
          preview: { title: `Hacer un reel en ${resolved.device.name}`, confirmLabel: 'Hacer el reel', fields },
        };
      },
      run: async (args, context) => {
        const given = { operation: 'reel', path: args.path, start: args.start, end: args.end, text: args.text, second: args.music, device: args.device };
        const resolved = await videoTool(await getUser(context), 'edit_video', given, 'confirm', { minVersion: MIN_AGENT_REEL });
        if (resolved.error) return { error: resolved.error };
        return forModel(await runOnDevice(resolved.device, resolved.tool, resolved.args), resolved);
      },
    },
    {
      label: 'Ver cómo va la edición',
      activity: 'Revisando la edición…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(summaryOf(result?.result), 120)),
      declaration: {
        name: 'video_status',
        description: 'Dice cómo va la edición del video que se está haciendo en el PC (porcentaje) o dónde quedó el archivo listo. Úsala cuando edit_video avisó que seguía editando o el usuario pregunta cómo va.',
        parameters: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'Id del trabajo (opcional; sin él, el último).' }, device: DEVICE_ARG } },
      },
      run: async (args, context) => {
        const resolved = await videoTool(await getUser(context), 'video_status', args, 'read');
        if (resolved.error) return { error: resolved.error };
        return forModel(await runOnDevice(resolved.device, resolved.tool, resolved.args), resolved);
      },
    },
  ],
  webhook: null,
};
