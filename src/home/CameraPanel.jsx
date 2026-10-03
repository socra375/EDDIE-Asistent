import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useVision } from '../context/visionState';
import Icon from '../layout/Icon';
import { HudPanel } from './HudPanel';
import { shareState, subscribeShare } from '../services/remoteShare';

const ENGINES = {
  local: 'Detector de este equipo',
  gemini: 'IA · Gemini',
  groq: 'IA · Groq',
  claude: 'IA · Claude',
};

// Who is looking: 'local' (this browser), 'local + groq' (it plus a cloud description)…
function engineLabel(provider) {
  if (!provider) return '';
  return provider
    .split(' + ')
    .map((p) => ENGINES[p] || p)
    .join(' + ');
}

const time = (at) => new Intl.DateTimeFormat('es', { timeStyle: 'medium' }).format(at);

// The camera of "Modo Vigilancia": the live picture with a box and a label
// over each thing the AI found, the list of what is there and a log of what
// came and went. The picture is mirrored like a mirror, so the boxes are too.
export default function CameraPanel() {
  const { phase, active, busy, engine, error, stream, scene, analyzing, note, events, perf, maxMinutes, toggle, grantConsent, cancelConsent } = useVision();
  const videoRef = useRef(null);
  const sharing = useSyncExternalStore(subscribeShare, () => shareState().sharing);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream, active]);

  const boxed = scene.objects.filter((o) => o.box);
  const listed = [...scene.objects, ...(scene.extras || [])];

  return (
    <HudPanel title="CÁMARA" className={`camera-panel ${active ? 'camera-panel--live' : ''}`} aside={active ? '● VIGILANCIA' : undefined}>
      <button
        type="button"
        className={`camera-panel__power ${busy ? 'camera-panel__power--on' : ''}`}
        onClick={toggle}
        aria-label={busy ? 'Apagar la cámara' : 'Encender la cámara'}
        aria-pressed={busy}
        title={busy ? 'Apagar la cámara' : 'Encender la cámara (Modo Vigilancia)'}
      >
        <Icon name="power" size={16} />
      </button>

      {phase === 'consent' && (
        <div className="camera-panel__card" role="dialog" aria-label="Permiso para usar la cámara">
          {engine === 'local' ? (
            <p>
              <b>Modo Vigilancia</b> usa tu cámara y un detector que corre <b>en este equipo</b>: reconoce objetos, personas y animales sin enviar ninguna imagen a nadie y
              <b> sin guardar nada</b>. La primera vez descarga el detector (unos 18 MB, una sola vez). No reconoce quién es una persona.
            </p>
          ) : engine === 'cloud' ? (
            <p>
              <b>Modo Vigilancia</b> usa tu cámara para identificar objetos, personas, animales y materiales. Cada pocos segundos (solo si algo cambió) se
              envía una imagen pequeña a la IA para analizarla; <b>no se guarda nada</b>. Eddie describe lo que ve, pero no reconoce quién es una persona.
            </p>
          ) : (
            <p>
              <b>Modo Vigilancia</b> usa tu cámara. Un detector que corre <b>en este equipo</b> reconoce objetos, personas y animales sin enviar nada; cada ~20 segundos
              (y solo si algo cambió) se envía una imagen pequeña a una IA gratuita para describirla mejor y ver materiales. <b>No se guarda nada</b>, y Eddie no reconoce quién es una persona.
            </p>
          )}
          <div className="hud-actions">
            <button type="button" className="btn" onClick={grantConsent}>
              Permitir y encender
            </button>
            <button type="button" className="btn" onClick={cancelConsent}>
              Ahora no
            </button>
          </div>
        </div>
      )}

      {(phase === 'off' || phase === 'error') && (
        <div className="camera-panel__off">
          <Icon name="camera" size={34} />
          <p>{phase === 'error' ? error : 'Cámara apagada'}</p>
          <p className="camera-panel__hint">{phase === 'error' ? 'Pulsa el botón de encendido para reintentar.' : 'Di «Modo Vigilancia» o pulsa el botón de encendido.'}</p>
          {phase === 'off' && note && <p className="camera-panel__hint">{note}</p>}
        </div>
      )}

      {phase === 'starting' && (
        <div className="camera-panel__off">
          <Icon name="camera" size={34} />
          <p>Pidiendo permiso a la cámara…</p>
        </div>
      )}

      {phase === 'watching' && (
        <>
          <div className="camera-panel__view">
            <video ref={videoRef} className="camera-panel__video" muted playsInline aria-label="Imagen de la cámara" />
            {boxed.map((o, i) => (
              <span
                key={`${o.label}-${i}`}
                className={`camera-box camera-box--${o.category === 'persona' ? 'person' : o.category === 'animal' ? 'animal' : 'thing'}`}
                style={{ top: `${o.box[0] / 10}%`, left: `${(1000 - o.box[3]) / 10}%`, height: `${(o.box[2] - o.box[0]) / 10}%`, width: `${(o.box[3] - o.box[1]) / 10}%` }}
              >
                <i>
                  {o.label}
                  {o.count > 1 ? ` ×${o.count}` : ''}
                </i>
              </span>
            ))}
          </div>
          {sharing && <p className="camera-panel__hint">● Transmitiendo esta cámara a otro dispositivo de tu cuenta.</p>}
          <p className={`camera-panel__note ${analyzing ? 'camera-panel__note--busy' : ''}`} role="status">
            {note}
          </p>

          {scene.summary && <p className="camera-panel__summary">{scene.summary}</p>}
          {scene.provider && (
            <p className="camera-panel__hint">
              {engineLabel(scene.provider)}
              {perf.ms > 0 && ` · cada análisis tarda ${(perf.ms / 1000).toFixed(1).replace('.', ',')} s (${perf.backend === 'webgl' ? 'gráficos' : 'procesador'})`}
            </p>
          )}
          {listed.length > 0 && (
            <ul className="camera-list" aria-label="Lo que se ve">
              {listed.map((o, i) => (
                <li key={`${o.label}-${i}`} className={`camera-list__item camera-list__item--${o.category === 'persona' ? 'person' : o.category === 'animal' ? 'animal' : 'thing'}`}>
                  <b>
                    {o.label}
                    {o.count > 1 ? ` ×${o.count}` : ''}
                  </b>
                  <span>
                    {[o.category, o.material, o.detail].filter(Boolean).join(' · ')} · {Math.round(o.confidence * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="camera-panel__log-title">REGISTRO</h3>
          {events.length === 0 ? (
            <p className="hud-empty">Sin eventos todavía.</p>
          ) : (
            <ul className="camera-log">
              {events.map((e) => (
                <li key={e.id} className={`camera-log__item camera-log__item--${e.type}`}>
                  <time>{time(e.at)}</time> {e.text}
                </li>
              ))}
            </ul>
          )}
          <p className="camera-panel__hint">Se apaga sola a los {maxMinutes} min. Di «desactiva el modo vigilancia» para apagarla.</p>
        </>
      )}
    </HudPanel>
  );
}
