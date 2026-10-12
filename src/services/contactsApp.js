// Contactos as an app of its own (/?app=contactos, installed from public/contactos.webmanifest).
export const isContactsApp = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('app') === 'contactos';

const RETURN_KEY = 'eddie.returnApp';
const RETURN_MS = 10 * 60 * 1000;

// The Google login always comes back to «/»; this brings the person back to Contactos afterwards.
export function rememberContactsReturn() {
  try {
    localStorage.setItem(RETURN_KEY, String(Date.now()));
  } catch {
    // Without storage the login simply lands on Eddie.
  }
}

export function resumeContactsAfterLogin() {
  try {
    const at = Number(localStorage.getItem(RETURN_KEY));
    if (!at) return;
    localStorage.removeItem(RETURN_KEY);
    if (Date.now() - at < RETURN_MS && !isContactsApp() && window.location.pathname === '/' && !window.location.search) window.location.replace('/?app=contactos');
  } catch {
    // ignore
  }
}
