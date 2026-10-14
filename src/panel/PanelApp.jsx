import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import ChatPanel from '../components/Chat/ChatPanel';
import { REASONS, inFrame, onExtensionAsk, pageBlock, panelContext, rememberUsePage, requestPageContext, tellParent, usePageDefault } from '../services/panelMode';
import './Panel.css';

// Eddie beside any website: the chat on its own, with one switch, «Usar esta página». When it is
// on, every message you send carries the text of the page you are looking at (the extension reads
// it, only because you allowed it; see extension/panel.js). Opened by the extension's side panel (a
// frame) or its own small window.
export default function PanelApp() {
  const { user, loading, login } = useAuth();
  const { sendMessage } = useChat();
  const [usePage, setUsePage] = useState(usePageDefault);
  const [status, setStatus] = useState('');
  const usePageRef = useRef(usePage);
  const sendRef = useRef(sendMessage);
  useEffect(() => {
    usePageRef.current = usePage;
    sendRef.current = sendMessage;
  });

  // Tells the panel page around us (the extension's) who is signed in, once it is known.
  useEffect(() => {
    if (!loading) tellParent({ type: 'ready', user: Boolean(user) });
  }, [loading, user]);

  // The chat asks for the page just before sending each message.
  useEffect(() => {
    panelContext.provide = async () => {
      if (!usePageRef.current) return '';
      const context = await requestPageContext();
      if (context?.ok) {
        setStatus(`Leí: ${context.title || context.url}`);
        return pageBlock(context);
      }
      setStatus(context?.reason ? REASONS[context.reason] || '' : 'No pude leer la página (¿está instalada y al día la extensión?).');
      return '';
    };
    return () => {
      panelContext.provide = null;
    };
  }, []);

  // A question from the extension's right-click menu.
  useEffect(() => onExtensionAsk((text) => sendRef.current(text)), []);

  function toggle(on) {
    setUsePage(on);
    rememberUsePage(on);
    setStatus('');
  }

  if (!loading && !user) {
    return (
      <main className="panel-app panel-app--center">
        <h2>Eddie</h2>
        <p>Inicia sesión con Google para hablar con Eddie desde cualquier web.</p>
        {inFrame() ? (
          <p className="panel-app__hint">Google no deja iniciar sesión dentro del panel: usa el botón de abajo del panel para abrir Eddie en una pestaña, inicia sesión y vuelve.</p>
        ) : (
          <button type="button" className="btn btn-primary" onClick={login}>
            Iniciar sesión con Google
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="panel-app">
      <header className="panel-app__bar">
        <label className="panel-app__switch">
          <input type="checkbox" checked={usePage} onChange={(e) => toggle(e.target.checked)} />
          <span>Usar esta página</span>
        </label>
        <span className="panel-app__status" role="status">{status || (usePage ? 'Leeré la web que veas cuando me escribas.' : 'No leo la página.')}</span>
      </header>
      <div className="panel-app__chat">
        <ChatPanel />
      </div>
    </main>
  );
}
