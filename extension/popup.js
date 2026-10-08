// The popup: whether the browser is linked, what is coming up, and a manual
// way to link (for an Eddie served from another address). Everything real
// happens in background.js; this only asks and shows.
import { serverOrigin } from './urls.js';

const $ = (id) => document.getElementById(id);
const ask = (message) => chrome.runtime.sendMessage(message);

function ago(time) {
  if (!time) return 'todavía no';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

function show(text) {
  $('message').hidden = !text;
  $('message').textContent = text || '';
}

function when(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function render() {
  const state = await ask({ type: 'state' });
  $('linked').hidden = !state.linked;
  $('unlinked').hidden = state.linked;
  if (!state.linked) {
    $('status').textContent = 'Todavía no está vinculado con Eddie.';
    $('status').className = 'muted';
    return;
  }
  const bad = Boolean(state.lastError);
  $('status').textContent = bad ? `No pude hablar con Eddie (${state.lastError}).` : 'Vinculado con Eddie.';
  $('status').className = bad ? 'bad' : 'ok';
  const lead = state.prefs?.autoMeetings === false ? 'reuniones: apagadas' : `reuniones: ${state.prefs?.leadMinutes ?? 1} min antes`;
  $('details').textContent = `${state.name || 'Este navegador'} · ${state.server} · último contacto ${ago(state.lastOk)} · ${lead} · v${state.version}`;
  $('meetings-title').hidden = state.meetings.length === 0;
  $('meetings').replaceChildren(
    ...state.meetings.map((m) => {
      const li = document.createElement('li');
      li.textContent = `${when(m.startsAt)} · ${m.title}`;
      return li;
    }),
  );
}

$('refresh').addEventListener('click', async () => {
  show('');
  $('refresh').disabled = true;
  await ask({ type: 'poll-now' });
  $('refresh').disabled = false;
  await render();
});

$('unlink').addEventListener('click', async () => {
  await ask({ type: 'unlink' });
  await render();
});

$('pair').addEventListener('click', async () => {
  show('');
  const origin = serverOrigin($('server').value.trim());
  const code = $('code').value.trim().toUpperCase();
  if (!origin) return show('La dirección debe empezar por https://.');
  if (!/^[A-Z2-9]{8}$/.test(code)) return show('El código tiene 8 letras o números.');
  // Asked here, from a click: the browser only allows it from the user's own action.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return show('Sin ese permiso no puedo hablar con tu Eddie.');
  const result = await ask({ type: 'pair', server: origin, code, name: 'Chrome' });
  if (!result.ok) return show(result.error || 'No se pudo vincular.');
  await render();
});

render();
