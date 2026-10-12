import { useEffect, useState } from 'react';
import CallScreen from '../call/CallScreen';
import { CALL_EVENT, startCall } from '../services/callState';
import { promptInstall, useInstallState } from '../services/pwa';
import ContactsPanel from './ContactsPanel';
import './Contacts.css';

// Contactos y llamadas as a web of its own (/contactos/, installable from its own manifest,
// public/contactos.webmanifest): the address book and the call with Eddie, none of the rest of
// Eddie. Same account and data; Eddie reads these contacts and the call is the same one.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export default function ContactsApp() {
  const install = useInstallState();
  const [hint, setHint] = useState(false);
  const [call, setCall] = useState(null);
  useEffect(() => {
    document.title = 'Contactos · Eddie';
    const onCall = (e) => setCall((current) => current || { incoming: Boolean(e.detail?.incoming) });
    window.addEventListener(CALL_EVENT, onCall);
    return () => window.removeEventListener(CALL_EVENT, onCall);
  }, []);

  async function installApp() {
    if ((await promptInstall()) === 'unavailable') setHint(true);
  }

  return (
    <main className="contacts-app">
      <header className="contacts-app__bar">
        <strong>Contactos</strong>
        <span className="contacts-app__links">
          <button type="button" className="btn btn-primary" onClick={() => startCall()}>
            Llamar a Eddie
          </button>
          {!install.installed && (
            <button type="button" className="btn" onClick={installApp}>
              Instalar
            </button>
          )}
          <a className="btn" href="/">Eddie</a>
        </span>
      </header>
      {hint && !install.installed && (
        <p className="contacts__note contacts-app__hint">
          {isIos() ? 'En iPhone: toca Compartir y luego «Añadir a pantalla de inicio».' : 'Abre el menú del navegador (⋮) y elige «Instalar app» o «Añadir a pantalla de inicio».'}
        </p>
      )}
      <ContactsPanel standalone />
      {call && <CallScreen incoming={call.incoming} onClose={() => setCall(null)} />}
    </main>
  );
}
