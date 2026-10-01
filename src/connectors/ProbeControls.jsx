import { useState } from 'react';
import { askProbe, cleanKey, cleanProbeUrl, pingProbe, DEFAULT_PROBE_URL } from '../services/probeCore';
import { saveProbeConfig, useProbeConfig } from '../services/probe';

// The local probe's card controls. Everything is kept in this browser only:
// the probe runs on this same computer and Eddie's server never sees it.
export default function ProbeControls() {
  const config = useProbeConfig();
  const [url, setUrl] = useState(config.url || DEFAULT_PROBE_URL);
  const [key, setKey] = useState(config.key || '');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { tone: ok|bad, text, tools? }
  const urlOk = Boolean(cleanProbeUrl(url));
  const keyOk = cleanKey(key) !== null;
  const dirty = url.trim() !== config.url || key.trim() !== config.key;

  function save() {
    if (!urlOk || !keyOk) return false;
    saveProbeConfig({ url: cleanProbeUrl(url), key: cleanKey(key) });
    setUrl(cleanProbeUrl(url));
    setKey(cleanKey(key));
    return true;
  }

  async function test(kind) {
    if (!save()) return;
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'ping') {
        const { ms } = await pingProbe({ url: cleanProbeUrl(url) });
        setResult({ tone: 'ok', text: `La sonda está encendida y responde (${ms} ms).` });
      } else {
        const { response, tools } = await askProbe({ url: cleanProbeUrl(url), key: cleanKey(key), message: 'Dame un resumen muy corto del estado de este equipo.' });
        setResult({ tone: 'ok', text: response.slice(0, 400), tools });
      }
    } catch (err) {
      setResult({ tone: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="probe">
      <label className="probe__field">
        <span>Dirección de la sonda</span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Dirección de la sonda" placeholder={DEFAULT_PROBE_URL} />
      </label>
      {!urlOk && <p className="connectors__warning">Debe ser una dirección de este equipo, por ejemplo {DEFAULT_PROBE_URL}.</p>}
      <label className="probe__field">
        <span>Clave (X-Eddie-Key)</span>
        <span className="probe__key">
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Clave de la sonda"
            placeholder="La misma que configuraste en la sonda"
          />
          <button type="button" className="btn" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey}>
            {showKey ? 'Ocultar' : 'Ver'}
          </button>
        </span>
      </label>
      {!keyOk && <p className="connectors__warning">La clave tiene caracteres no válidos (sin espacios ni acentos).</p>}
      <div className="probe__actions">
        <button type="button" className="btn btn-primary" disabled={!urlOk || !keyOk || !dirty} onClick={save}>
          Guardar
        </button>
        <button type="button" className="btn" disabled={!urlOk || Boolean(busy)} onClick={() => test('ping')}>
          {busy === 'ping' ? 'Probando…' : 'Probar conexión'}
        </button>
        <button type="button" className="btn" disabled={!urlOk || !keyOk || Boolean(busy)} onClick={() => test('ask')}>
          {busy === 'ask' ? 'Preguntando… (puede tardar)' : 'Enviar pregunta de prueba'}
        </button>
      </div>
      {result && (
        <div className={`probe__result probe__result--${result.tone}`} role="status">
          <p>{result.text}</p>
          {result.tools?.length > 0 && <p className="connector__meta">Herramientas usadas: {result.tools.join(', ')}</p>}
        </div>
      )}
      <label className="settings-toggle">
        <input type="checkbox" checked={config.enabled} onChange={(e) => saveProbeConfig({ enabled: e.target.checked })} />
        <span>Usar la sonda en el chat (aparece la habilidad «Sonda»)</span>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={config.auto} disabled={!config.enabled} onChange={(e) => saveProbeConfig({ auto: e.target.checked })} />
        <span>Detectar solo las preguntas sobre el equipo (disco, memoria, batería…) y mandarlas a la sonda</span>
      </label>
      <p className="connector__meta">La dirección y la clave se guardan solo en este navegador; nunca pasan por el servidor de Eddie.</p>
    </div>
  );
}
