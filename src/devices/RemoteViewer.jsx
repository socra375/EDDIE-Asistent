import { useCallback, useEffect, useRef, useState } from 'react';
import { commandState, sendCommand, viewFrame } from '../services/devices';
import { REMOTE_VIEW_EVENT } from '../services/remoteShare';
import Icon from '../layout/Icon';
import './RemoteViewer.css';

const POLL_MS = 1000;
const START_WAIT_MS = 20_000;
const MAX_ERRORS = 5;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const catClass = (category) => (category === 'persona' ? 'person' : category === 'animal' ? 'animal' : 'thing');

// "Ver cámara" on another device: a floating window with what that device's
// camera sees (about one picture a second, with a box over each thing found)
// and what it says about it. Opened from Configuración → Dispositivos or when
// Eddie shows a device's camera ("enséñame lo que ve el Chromebook"); closing
// it tells the device to stop sharing and turn the camera off if this turned it on.
export default function RemoteViewer() {
  const [view, setView] = useState(null); // { deviceId, name, attach }
  const [phase, setPhase] = useState('starting'); // starting | waiting | live | error
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState(null); // { url, meta, caption, at }
  const [now, setNow] = useState(() => Date.now());
  const viewRef = useRef(null);

  useEffect(() => {
    const open = (e) => {
      const { deviceId, name, attach } = e.detail || {};
      if (!deviceId) return;
      setShot(null);
      setPhase(attach ? 'waiting' : 'starting');
      setMessage('');
      setView((current) => (current?.deviceId === deviceId ? current : { deviceId, name: name || 'el dispositivo', attach: Boolean(attach) }));
    };
    window.addEventListener(REMOTE_VIEW_EVENT, open);
    return () => window.removeEventListener(REMOTE_VIEW_EVENT, open);
  }, []);

  useEffect(() => {
    viewRef.current = view;
    if (!view) return undefined;
    let alive = true;

    // 1. Ask the device to share (unless Eddie already did).
    const begin = async () => {
      if (view.attach) return;
      try {
        const sent = await sendCommand(view.deviceId, 'view_start');
        const started = Date.now();
        for (;;) {
          await wait(500);
          if (!alive) return;
          const s = await commandState(sent.id);
          if (s.status === 'done') return;
          if (s.status === 'consent') {
            setMessage(s.text);
            return;
          }
          if (s.status === 'error' || s.status === 'expired') throw new Error(s.text || 'El dispositivo no pudo compartir la cámara.');
          if (Date.now() - started > START_WAIT_MS) throw new Error(`${view.name} no respondió a tiempo. Puede que Eddie esté cerrado o en segundo plano allí.`);
        }
      } catch (err) {
        if (!alive) return;
        setPhase('error');
        setMessage(err.message);
      }
    };

    // 2. Take its pictures (asking is also what tells it that somebody is watching).
    let errors = 0;
    const poll = async () => {
      while (alive) {
        try {
          const data = await viewFrame(view.deviceId);
          if (!alive) return;
          errors = 0;
          if (data.frame) {
            const url = `data:image/jpeg;base64,${data.frame}`;
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = resolve;
              img.onerror = resolve;
              img.src = url; // decoded before it replaces the one on screen: no flicker
            });
            if (!alive) return;
            setShot({ url, meta: data.meta, caption: data.caption, at: Date.now() - (data.ageMs || 0) });
            setPhase('live');
            setMessage('');
          } else if (!data.online) {
            setPhase((p) => (p === 'error' ? p : 'waiting'));
            setMessage(`${view.name} parece apagado o sin conexión.`);
          } else {
            setPhase((p) => (p === 'live' || p === 'error' ? p : 'waiting'));
          }
        } catch (err) {
          errors += 1;
          if (errors >= MAX_ERRORS && alive) {
            setPhase('error');
            setMessage(err.message);
            return;
          }
        }
        await wait(POLL_MS);
      }
    };

    begin();
    poll();
    const clock = window.setInterval(() => setNow(Date.now()), 1000); // "hace 2 s"
    return () => {
      alive = false;
      window.clearInterval(clock);
    };
  }, [view]);

  const close = useCallback(() => {
    const current = viewRef.current;
    setView(null);
    setShot(null);
    // The device stops sharing and, if the viewer had turned its camera on, switches it off.
    if (current) sendCommand(current.deviceId, 'view_stop').catch(() => {});
  }, []);

  useEffect(() => {
    if (!view) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, close]);

  if (!view) return null;
  const age = shot ? Math.max(0, Math.round((now - shot.at) / 1000)) : 0;
  const stale = phase === 'live' && age > 6;
  const objects = shot?.meta?.objects || [];

  return (
    <aside className="remote-view" role="dialog" aria-label={`Cámara de ${view.name}`}>
      <header className="remote-view__head">
        <strong>CÁMARA · {view.name}</strong>
        <span className={`chip ${phase === 'live' && !stale ? 'on' : phase === 'error' ? 'bad' : 'warn'}`}>
          {phase === 'live' ? (stale ? `SIN SEÑAL · ${age} s` : age <= 2 ? 'EN VIVO' : `HACE ${age} s`) : phase === 'error' ? 'ERROR' : 'CONECTANDO…'}
        </span>
        <button type="button" className="remote-view__close" onClick={close} aria-label="Cerrar la cámara remota" title="Cerrar (el dispositivo deja de transmitir)">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="remote-view__stage">
        {shot ? (
          <>
            <img src={shot.url} alt={`Lo que ve la cámara de ${view.name}`} className={stale ? 'remote-view__img remote-view__img--stale' : 'remote-view__img'} />
            {objects
              .filter((o) => o.box)
              .map((o, i) => (
                <span
                  key={`${o.label}-${i}`}
                  className={`camera-box camera-box--${catClass(o.category)}`}
                  style={{ top: `${o.box[0] / 10}%`, left: `${o.box[1] / 10}%`, height: `${(o.box[2] - o.box[0]) / 10}%`, width: `${(o.box[3] - o.box[1]) / 10}%` }}
                >
                  <i>
                    {o.label}
                    {o.count > 1 ? ` ×${o.count}` : ''}
                  </i>
                </span>
              ))}
          </>
        ) : (
          <div className="remote-view__wait">
            <Icon name="camera" size={34} />
            <p>{phase === 'error' ? message : message || (phase === 'starting' ? `Pidiéndole la cámara a ${view.name}…` : 'Esperando la primera imagen…')}</p>
          </div>
        )}
      </div>

      {shot?.caption && <p className="remote-view__caption">{shot.caption}</p>}
      {shot && message && <p className="remote-view__note">{message}</p>}
      {objects.length > 0 && (
        <ul className="remote-view__list" aria-label="Lo que se ve">
          {objects.slice(0, 8).map((o, i) => (
            <li key={`${o.label}-${i}`} className={`camera-list__item camera-list__item--${catClass(o.category)}`}>
              <b>
                {o.label}
                {o.count > 1 ? ` ×${o.count}` : ''}
              </b>
              <span>{Math.round((o.confidence || 0) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      <p className="remote-view__hint">La imagen pasa por tu cuenta de Eddie solo mientras la ves (no se guarda) y se corta sola a los 10 min. En el otro equipo se ve el chip «TRANSMITIENDO».</p>
    </aside>
  );
}
