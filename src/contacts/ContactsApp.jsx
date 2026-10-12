import { useEffect, useState } from 'react';
import { useInstallState, promptInstall } from '../services/pwa';
import ContactsPanel from './ContactsPanel';
import './Contacts.css';

// Contactos as an app of its own (/?app=contactos, installed from its own manifest,
// public/contactos.webmanifest): just the address book, outside Eddie's shell. It is
// the same screen, the same account and the same data; Eddie reads these contacts too.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export default function ContactsApp() {
  const install = useInstallState();
  const [hint, setHint] = useState(false);
  useEffect(() => {
    document.title = 'Contactos · Eddie';
  }, []);

  async function installApp() {
    const result = await promptInstall();
    if (result === 'unavailable') setHint(true);
  }

  return (
    <main className="contacts-app">
      <header className="contacts-app__bar">
        <strong>Contactos</strong>
        <span className="contacts-app__links">
          {!install.installed && (
            <button type="button" className="btn btn-primary" onClick={installApp}>
              Instalar app
            </button>
          )}
          <a className="btn" href="/">Abrir Eddie</a>
        </span>
      </header>
      {hint && !install.installed && (
        <p className="contacts__note contacts-app__hint">
          {isIos() ? 'En iPhone: toca Compartir y luego «Añadir a pantalla de inicio».' : 'Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».'}
        </p>
      )}
      <ContactsPanel standalone />
    </main>
  );
}
