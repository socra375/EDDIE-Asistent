import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { exportTxt, exportDoc, exportPdf } from '../../utils/export';
import { remoteDrive } from '../../services/remote';

// Long replies and anything written with the Documentos skill can leave the
// chat: copy, download as TXT/DOC, print to PDF, or save to Google Drive.
const EXPORT_MIN_CHARS = 600;

// Plain ASCII: some browsers drop a download's name when it has accents.
function toFilename(title) {
  const ascii = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ascii.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 60) || 'eddie';
}

export default function MessageActions({ message }) {
  const { user } = useAuth();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const title = message.title || 'Respuesta de Eddie';
  const exportable = message.skill === 'documents' || message.content.length >= EXPORT_MIN_CHARS;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setNotice('Copiado');
    } catch {
      setNotice('No se pudo copiar');
    }
  }

  function download(format) {
    setNotice('');
    try {
      if (format === 'txt') exportTxt(toFilename(title), message.content);
      if (format === 'doc') exportDoc(toFilename(title), title, message.content);
      if (format === 'pdf') exportPdf(title, message.content);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function saveToDrive() {
    setBusy(true);
    setNotice('');
    try {
      const result = await remoteDrive.save(`${toFilename(title)}.txt`, message.content, 'text/plain');
      setNotice(result?.webViewLink ? 'Guardado en Drive' : 'No se pudo guardar');
      if (result?.webViewLink) window.open(result.webViewLink, '_blank', 'noopener');
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bubble__actions">
      <button type="button" className="bubble__action" onClick={copy}>
        Copiar
      </button>
      {exportable && (
        <>
          <button type="button" className="bubble__action" onClick={() => download('txt')}>
            TXT
          </button>
          <button type="button" className="bubble__action" onClick={() => download('doc')}>
            DOC
          </button>
          <button type="button" className="bubble__action" onClick={() => download('pdf')}>
            PDF
          </button>
          {user && (
            <button type="button" className="bubble__action" onClick={saveToDrive} disabled={busy}>
              {busy ? 'Guardando…' : 'Drive'}
            </button>
          )}
        </>
      )}
      {notice && (
        <span className="bubble__notice" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
