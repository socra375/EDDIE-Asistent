// Sending tab orders to the user's browser (routines/tabs.js says what they are). The order waits for the browser for
// TABS_TTL_SECONDS; if the extension has not been heard from lately the browser is probably closed, so the computer's agent is
// asked to start it (the extension takes the order as soon as the browser opens).
import { enqueue, linkByUser, TABS_URL } from '../browser/store.js';
import { createJob, devicesByUser } from '../computer/store.js';
import { browserKind, describeSteps } from './tabs.js';

export const TABS_TTL_SECONDS = 15 * 60;
const ASLEEP_MS = 2 * 60 * 1000;

const real = { linkByUser, enqueue, devicesByUser, createJob };

// → one line for the notice the routine sends.
export async function runTabs(user, steps, key = null, { forceStart = false, deps = {} } = {}) {
  const d = { ...real, ...deps };
  if (!steps.length) return '';
  const link = await d.linkByUser(user.id);
  if (!link) return '🌐 Quería ocuparme de tus pestañas, pero no tienes tu navegador vinculado (Conectores → Tu navegador).';
  try {
    await d.enqueue(user.id, { url: TABS_URL, kind: 'tabs', payload: { steps, ...(key ? { key } : {}) }, ttl: TABS_TTL_SECONDS });
  } catch (err) {
    return `🌐 No pude pedirle a tu navegador lo de las pestañas: ${err.message}`;
  }
  let started = false;
  const asleep = forceStart || !link.lastSeen || Date.now() - Date.parse(link.lastSeen) > ASLEEP_MS;
  if (asleep) {
    try {
      const device = (await d.devicesByUser(user.id)).find((x) => x.tools.some((t) => t.name === 'start_browser'));
      if (device) {
        await d.createJob(device.id, 'start_browser', { browser: browserKind(link.name) });
        started = true;
      }
    } catch {
      // the order stays queued; it runs when the browser is next opened
    }
  }
  return `🌐 Pedí al navegador: ${describeSteps(steps)}.${started ? ' Parecía cerrado: le pedí a tu PC que lo abra.' : ''}`;
}
