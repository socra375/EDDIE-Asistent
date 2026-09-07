import { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useAuth } from '../../context/AuthContext';
import { exportTxt, exportCsv, exportDoc, exportPdf } from '../../utils/export';
import { remoteDrive } from '../../services/remote';
import RichText from '../Shared/RichText';
import './Documents.css';

const TYPES = [
  { id: 'resumen', label: 'Resumen', build: (t) => `Escribe un resumen bien estructurado sobre "${t}".` },
  { id: 'informe', label: 'Informe', build: (t) => `Redacta un informe con introducción, desarrollo y conclusión sobre "${t}".` },
  { id: 'guia', label: 'Guía de estudio', build: (t) => `Crea una guía de estudio completa sobre "${t}", con puntos clave y ejemplos.` },
  { id: 'esquema', label: 'Esquema para exposición', build: (t) => `Crea un esquema para una exposición sobre "${t}", con secciones y viñetas.` },
  { id: 'cuestionario', label: 'Cuestionario', build: (t) => `Genera un cuestionario de 8 preguntas sobre "${t}" con respuestas al final.` },
];

export default function DocumentsPanel() {
  const { sendMessage } = useChat();
  const { user } = useAuth();
  const [topic, setTopic] = useState('');
  const [type, setType] = useState('resumen');
  const [loading, setLoading] = useState(false);
  const [doc, setDoc] = useState(null);
  const [exportError, setExportError] = useState('');
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveLink, setDriveLink] = useState('');

  async function handleGenerate(e) {
    e.preventDefault();
    if (!topic.trim()) return;
    const config = TYPES.find((t) => t.id === type);
    setLoading(true);
    setDoc(null);
    const reply = await sendMessage(config.build(topic.trim()), { mode: 'explicativo' });
    setLoading(false);
    setDriveLink('');
    if (reply) setDoc({ title: `${config.label}: ${topic.trim()}`, content: reply.content });
  }

  async function handleSaveToDrive() {
    if (!doc) return;
    setExportError('');
    setSavingToDrive(true);
    try {
      const filename = `${doc.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.txt`;
      const result = await remoteDrive.save(filename, doc.content, 'text/plain');
      if (result) setDriveLink(result.webViewLink);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setSavingToDrive(false);
    }
  }

  function handleExport(format) {
    if (!doc) return;
    setExportError('');
    try {
      const filename = doc.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      if (format === 'txt') exportTxt(filename, doc.content);
      if (format === 'csv') exportCsv(filename, doc.content);
      if (format === 'doc') exportDoc(filename, doc.title, doc.content);
      if (format === 'pdf') exportPdf(doc.title, doc.content);
    } catch (err) {
      setExportError(err.message);
    }
  }

  return (
    <section className="documents-panel">
      <form className="glass-panel documents-form" onSubmit={handleGenerate}>
        <h2>Creación de documentos</h2>
        <label>
          <span className="field-label">Tema</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="p. ej. La Revolución Industrial" />
        </label>
        <label>
          <span className="field-label">Tipo de documento</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={!topic.trim() || loading}>
          {loading ? 'Redactando…' : 'Generar documento'}
        </button>
      </form>

      <div className="glass-panel documents-result">
        <div className="documents-result__header">
          <h2>{doc?.title || 'Resultado'}</h2>
          {doc && (
            <div className="documents-result__actions">
              <button type="button" className="btn" onClick={() => handleExport('txt')}>
                TXT
              </button>
              <button type="button" className="btn" onClick={() => handleExport('csv')}>
                CSV
              </button>
              <button type="button" className="btn" onClick={() => handleExport('doc')}>
                DOCX
              </button>
              <button type="button" className="btn" onClick={() => handleExport('pdf')}>
                PDF
              </button>
              {user && (
                <button type="button" className="btn" onClick={handleSaveToDrive} disabled={savingToDrive}>
                  {savingToDrive ? 'Guardando…' : '📁 Guardar en Drive'}
                </button>
              )}
            </div>
          )}
        </div>
        {exportError && <p className="documents-error">{exportError}</p>}
        {driveLink && (
          <p className="documents-drive-link">
            Guardado en Drive:{' '}
            <a href={driveLink} target="_blank" rel="noreferrer">
              abrir archivo
            </a>
          </p>
        )}
        {!doc && !loading && <p className="documents-placeholder">El documento generado por Eddie aparecerá aquí, listo para exportar.</p>}
        {loading && <p className="documents-placeholder">Analizando tu solicitud…</p>}
        {doc && <RichText text={doc.content} />}
      </div>
    </section>
  );
}
