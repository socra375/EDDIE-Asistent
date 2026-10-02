// The start-up animation (src/boot/BootSplash.jsx): when it plays and what it
// says. Pure, so it can be tested in Node.
export const BOOT_REPLAY_EVENT = 'eddie:boot-replay';
export const BOOT_SEEN_KEY = 'eddie.booted';

// The lines of the boot log, label and state.
export const BOOT_LINES = [
  ['NÚCLEO DE ARCO', 'ESTABLE'],
  ['ENLACE SATELITAL', 'CONECTADO'],
  ['PROTOCOLO DE VOZ', 'ACTIVO'],
  ['VISIÓN ARTIFICIAL', 'EN ESPERA'],
  ['MEMORIA', 'SINCRONIZADA'],
  ['CONECTORES', 'LISTOS'],
];

// The gauges on the right.
export const BOOT_GAUGES = ['ENERGÍA', 'INTEGRIDAD', 'SINCRONÍA'];

export function greetingFor(date = new Date()) {
  const h = date.getHours();
  const part = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${part}, señor.`;
}

// It plays once each time Eddie is opened (not on every reload of the same
// tab), unless the user turned it off, and never when a shortcut opened Eddie
// to do something right away ("Hablar con Eddie", "Modo Vigilancia").
export function shouldShowBoot({ enabled = true, seen = false, shortcut = false } = {}) {
  return Boolean(enabled) && !seen && !shortcut;
}

// How long it runs before it leaves by itself (ms); a lot shorter when the
// system asks for less motion.
export function bootDuration(reducedMotion = false) {
  return reducedMotion ? 1400 : 4300;
}
