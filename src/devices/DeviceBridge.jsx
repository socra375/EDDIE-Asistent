import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { ackCommand, heartbeat, takeCommands } from '../services/devices';
import { DEVICE_CHANGED_EVENT, readIdentity } from '../services/deviceIdentity';
import { resyncPush } from '../services/push';
import { VIGILANCE_EVENT, visionBridge } from '../services/visionBridge';

const BEAT_MS = 2 * 60 * 1000;
const CAMERA_WAIT_MS = 2500;
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
  useEffect(() => {
    if (!userId) return undefined;
    let stopped = false;
    let source = null;
    let sourceTopic = '';
    let pulling = false;

    async function execute(command) {
      const answer = (status, message = '') => ackCommand(clientId, command.id, status, message).catch(() => {});
      if (command.action === 'vigilance_off') {
        window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'off', remote: true } }));
        noteRef.current?.('Otro dispositivo de tu cuenta apagó el Modo Vigilancia aquí.');
        await answer('done');
        return;
      }
      if (command.action !== 'vigilance_on') return answer('error', 'Orden desconocida');
      if (!visionBridge.isSupported()) return answer('error', 'Este navegador no permite usar la cámara');
      if (visionBridge.isActive()) return answer('done');
      const hadConsent = visionBridge.hasConsent();
      window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: 'on', remote: true } }));
      noteRef.current?.(
        hadConsent
          ? 'Otro dispositivo de tu cuenta activó el Modo Vigilancia aquí.'
          : 'Otro dispositivo de tu cuenta pidió activar el Modo Vigilancia aquí. Acepta el permiso de la cámara en el panel Cámara para empezar.',
      );
      if (!hadConsent) return answer('consent');
      await wait(CAMERA_WAIT_MS);
      const { phase, error } = visionBridge.status();
      if (phase === 'watching') return answer('done');
      if (phase === 'starting' || phase === 'consent') return answer('consent');
      return answer('error', error || 'No se pudo encender la cámara');
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
      source?.close();
    };
  }, [userId, clientId, name, platform, allowRemote]);

  return null;
}
