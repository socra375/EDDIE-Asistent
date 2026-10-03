import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { ackCommand, heartbeat, shareFrame, takeCommands } from '../services/devices';
import { setSharing } from '../services/remoteShare';
import { readConsent } from '../services/camera';
import { DEVICE_CHANGED_EVENT, readIdentity } from '../services/deviceIdentity';
import { resyncPush } from '../services/push';
import { VIGILANCE_EVENT, visionBridge } from '../services/visionBridge';

const BEAT_MS = 2 * 60 * 1000;
// How long a command waits for the camera to come on before saying "it is still asking".
const CAMERA_WAIT_MS = 6000;
const POLL_MS = 250;
// Remote view: a picture about every second, while somebody watches.
const SHARE_EVERY_MS = 1000;
const SHARE_CHECK_MS = 400; // looks this often; the first picture goes out as soon as the camera is ready
const SHARE_MAX_MS = 10 * 60 * 1000;
const SHARE_ACTIVATE_MS = 2 * 60 * 1000; // the camera never came on (permission not given)
const SHARE_IDLE_LIMIT = 3; // answers in a row saying "nobody is watching"
const SHARE_ERROR_LIMIT = 5;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps this browser registered as one of the account's devices ("Eddie está
// abierto aquí") and, only if the user switched "control remoto" on for it,
// listens for the doorbell that says "another of your devices sent an order",
// takes it and does it: today, switching Modo Vigilancia on or off. The
// doorbell (ntfy) carries no data; the order itself is fetched from Eddie with
// the login cookie. Renders nothing.
export default function DeviceBridge() {
  const { user } = useAuth();
  const { addNote } = useChat();
  const [identity, setIdentity] = useState(readIdentity);
  const noteRef = useRef(addNote);
  useEffect(() => {
    noteRef.current = addNote;
  });

  // This device's own settings changed (Configuración → Dispositivos).
  useEffect(() => {
    const sync = () => setIdentity(readIdentity());
    window.addEventListener(DEVICE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DEVICE_CHANGED_EVENT, sync);
  }, []);

  const userId = user?.id || null;
  const { clientId, name, platform, allowRemote } = identity;

  // A device that accepts remote control and already has camera permission gets its
  // detector ready in the background, so an order from another device answers at once.
  useEffect(() => {
    if (!userId || !allowRemote || !readConsent()) return undefined;
    const timer = window.setTimeout(() => import('../services/localVision').then((m) => m.loadLocalDetector()).catch(() => {}), 4000);
    return () => window.clearTimeout(timer);
  }, [userId, allowRemote]);
  useEffect(() => {
    if (!userId) return undefined;
    let stopped = false;
    let source = null;
    let sourceTopic = '';
    let pulling = false;

    async function execute(command) {
      const answer = (status, message = '') => ackCommand(clientId, command.id, status, message).catch(() => {});
      if (command.action === 'vigilance_off') {
        stopShare();
        window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'off', remote: true } }));
        noteRef.current?.('Otro dispositivo de tu cuenta apagó el Modo Vigilancia aquí.');
        await answer('done');
        return;
      }
      if (command.action === 'view_stop') {
        stopShare('Otro dispositivo de tu cuenta dejó de ver esta cámara.');
        await answer('done');
        return;
      }
      if (command.action !== 'vigilance_on' && command.action !== 'view_start') return answer('error', 'Orden desconocida');
      const watch = command.action === 'view_start';
      if (!visionBridge.isSupported()) return answer('error', 'Este navegador no permite usar la cámara');
      const wasActive = visionBridge.isActive();
      const hadConsent = visionBridge.hasConsent();
      if (!wasActive) window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'on', remote: true } }));
      if (watch) startShare({ turnedOn: !wasActive });
      if (!wasActive) {
        noteRef.current?.(
          watch
            ? hadConsent
              ? 'Otro dispositivo de tu cuenta está viendo lo que ve esta cámara. Se ve el chip «TRANSMITIENDO» arriba.'
              : 'Otro dispositivo de tu cuenta pidió ver esta cámara. Acepta el permiso de la cámara en el panel Cámara para empezar.'
            : hadConsent
              ? 'Otro dispositivo de tu cuenta activó el Modo Vigilancia aquí.'
              : 'Otro dispositivo de tu cuenta pidió activar el Modo Vigilancia aquí. Acepta el permiso de la cámara en el panel Cámara para empezar.',
        );
      }
      if (wasActive) return answer('done');
      if (!hadConsent) return answer('consent');
      // As soon as the camera is on (usually well under a second), not after a fixed wait.
      const began = Date.now();
      for (;;) {
        await wait(POLL_MS);
        const { phase, error } = visionBridge.status();
        if (phase === 'watching') return answer('done');
        if (phase === 'error') return answer('error', error || 'No se pudo encender la cámara');
        if (phase === 'consent') return answer('consent');
        if (phase === 'off' && Date.now() - began > 1200) return answer('error', error || 'No se pudo encender la cámara');
        if (Date.now() - began > CAMERA_WAIT_MS) return answer('consent');
      }
    }

    // ---- Remote view: this device shares a picture while another one watches ----
    const share = { want: false, timer: null, busy: false, idle: 0, errors: 0, startedAt: 0, lastSent: 0, sawActive: false, turnedOn: false };

    function stopShare(message) {
      if (!share.want) return;
      share.want = false;
      window.clearInterval(share.timer);
      share.timer = null;
      setSharing(false);
      // The camera was turned on for the viewer: it goes off with them.
      if (share.turnedOn && visionBridge.isActive()) window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'off', remote: true } }));
      if (message) noteRef.current?.(message);
    }

    async function shareTick() {
      if (!share.want || share.busy || stopped) return;
      const now = Date.now();
      if (now - share.startedAt > SHARE_MAX_MS) return stopShare('Dejé de compartir la cámara: pasaron 10 minutos.');
      if (!visionBridge.isActive()) {
        if (share.sawActive) return stopShare('Dejé de compartir la cámara: la vigilancia se apagó.');
        if (now - share.startedAt > SHARE_ACTIVATE_MS) return stopShare('Dejé de compartir la cámara: no se encendió (¿falta el permiso?).');
        return undefined;
      }
      share.sawActive = true;
      if (document.hidden || now - share.lastSent < SHARE_EVERY_MS) return undefined;
      const snap = visionBridge.snapshot();
      if (!snap) return undefined;
      share.busy = true;
      share.lastSent = now;
      try {
        const { watching } = await shareFrame({ clientId, frame: snap.data, meta: snap.meta });
        share.errors = 0;
        share.idle = watching ? 0 : share.idle + 1;
        if (share.idle >= SHARE_IDLE_LIMIT) stopShare('Dejé de compartir la cámara: nadie la estaba viendo.');
      } catch (err) {
        share.errors += 1;
        if (err.status === 403 || share.errors >= SHARE_ERROR_LIMIT) stopShare('Dejé de compartir la cámara: no pude enviar la imagen.');
      } finally {
        share.busy = false;
      }
      return undefined;
    }

    function startShare({ turnedOn }) {
      if (share.want) {
        share.idle = 0;
        share.startedAt = Date.now();
        return;
      }
      Object.assign(share, { want: true, idle: 0, errors: 0, startedAt: Date.now(), lastSent: 0, sawActive: false, turnedOn });
      setSharing(true);
      share.timer = window.setInterval(shareTick, SHARE_CHECK_MS);
    }

    // Takes whatever is waiting for this device and does it, one at a time.
    async function pull() {
      if (pulling || stopped) return;
      pulling = true;
      try {
        const { commands } = await takeCommands(clientId);
        for (const command of commands || []) await execute(command);
      } catch {
        // Next doorbell or check-in.
      } finally {
        pulling = false;
      }
    }

    function listen(topic, ntfy) {
      if (!topic || !ntfy) {
        source?.close();
        source = null;
        sourceTopic = '';
        return;
      }
      if (source && sourceTopic === topic) return;
      source?.close();
      sourceTopic = topic;
      try {
        source = new EventSource(`${ntfy}/${topic}/sse`);
        source.onmessage = () => pull();
        source.onopen = () => pull();
      } catch {
        source = null; // the check-in will still pick commands up
      }
    }

    async function beat() {
      if (stopped) return;
      try {
        const info = await heartbeat({ clientId, name, platform, allowRemote });
        if (stopped) return;
        listen(allowRemote ? info.topic : '', info.ntfy);
        if (allowRemote && info.pending > 0) pull();
      } catch {
        // Offline or signed out: the next one will try again.
      }
    }

    beat();
    // A browser that already accepted notifications belongs to whoever is signed in now.
    resyncPush({ clientId, platform });
    const timer = window.setInterval(beat, BEAT_MS);
    const onVisible = () => !document.hidden && beat();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', beat);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', beat);
      stopShare();
      source?.close();
    };
  }, [userId, clientId, name, platform, allowRemote]);

  return null;
}
