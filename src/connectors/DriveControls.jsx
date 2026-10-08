import { useState } from 'react';
import Icon from '../layout/Icon';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const PURPOSES = [
  { id: 'negocio', label: 'Negocio', hint: 'tus negocios, el contexto, la información y los planes' },
  { id: 'clientes', label: 'Servicio al cliente', hint: 'cómo hablas, tus clientes y su información' },
  { id: 'otro', label: 'Otra', hint: 'cualquier otra información' },
];

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/drive/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

// "Carpetas de Drive": paste the link of a folder, say what it is for, and Eddie
// looks there (read-only) when he is asked about a client, a business or a plan.
export default function DriveControls({ connector, docsConnected, onChanged }) {
  const folders = connector.details?.folders || [];
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState('negocio');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (connector.status !== 'connected') return null;

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
      onChanged(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="drivefolders">
      {folders.length > 0 ? (
        <ul className="drivefolders__list" aria-label="Carpetas conectadas">
          {folders.map((f) => (
            <li key={f.id}>
              <Icon name="cloud" size={14} />
              <span className="drivefolders__name">{f.name}</span>
              <span className="drivefolders__purpose">{PURPOSES.find((p) => p.id === f.purpose)?.label || 'Otra'}</span>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy)} aria-label={`Quitar ${f.name}`} onClick={() => run('remove', () => post('remove', { id: f.id }))}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="connector__meta">Todavía no hay carpetas conectadas.</p>
      )}

      <form
        className="drivefolders__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          run('add', async () => {
            await post('add', { url: url.trim(), purpose });
            setUrl('');
          });
        }}
      >
        <label>
          <span>Enlace de la carpeta</span>
          <input type="text" inputMode="url" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" disabled={Boolean(busy)} />
        </label>
        <label>
          <span>Para qué es</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={Boolean(busy)}>
            {PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !url.trim()}>
          {busy === 'add' ? 'Conectando…' : 'Conectar carpeta'}
        </button>
      </form>
      <p className="connector__meta">Abre la carpeta en drive.google.com y copia el enlace de la barra de direcciones. Eddie mira lo que hay dentro, incluidas las subcarpetas.</p>

      {!docsConnected && (
        <p className="connectors__warning" role="status">
          Para que Eddie pueda leer el texto de los documentos y hojas de esas carpetas, conecta también «Google Docs y Sheets».
        </p>
      )}
      {error && (
        <p className="connectors__warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
