// Contactos y llamadas as a web of its own: /contactos/ (own manifest and scope in
// public/contactos.webmanifest, so Chrome installs it apart from Eddie).
export const CONTACTS_PATH = '/contactos/';
export const isContactsApp = () => typeof window !== 'undefined' && /^\/contactos(\/|$)/.test(window.location.pathname);

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

// From Eddie's own address: an old /?app=contactos link, or a login that was started in Contactos.
export function resumeContactsAfterLogin() {
  try {
    if (new URLSearchParams(window.location.search).get('app') === 'contactos') {
      window.location.replace(CONTACTS_PATH);
      return;
    }
    const at = Number(localStorage.getItem(RETURN_KEY));
    if (!at) return;
    localStorage.removeItem(RETURN_KEY);
    if (Date.now() - at < RETURN_MS && window.location.pathname === '/' && !window.location.search) window.location.replace(CONTACTS_PATH);
  } catch {
    // ignore
  }
}
