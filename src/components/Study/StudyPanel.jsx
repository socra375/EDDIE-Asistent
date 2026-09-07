import { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useSettings } from '../../context/SettingsContext';
import RichText from '../Shared/RichText';
import './Study.css';

const ACTIONS = [
  { id: 'explicar', label: 'Explicar desde cero', build: (t, l) => `Explícame "${t}" desde cero, a nivel ${l}, con analogías simples.` },
  { id: 'resumen', label: 'Resumen', build: (t, l) => `Crea un resumen claro de "${t}" a nivel ${l}.` },
  { id: 'cuestionario', label: 'Cuestionario', build: (t, l) => `Genera un cuestionario de 5 preguntas sobre "${t}" a nivel ${l}, con las respuestas al final.` },
  { id: 'flashcards', label: 'Flashcards', build: (t, l) => `Crea 8 flashcards (pregunta y respuesta) sobre "${t}" a nivel ${l}.` },
  { id: 'esquema', label: 'Mapa conceptual (texto)', build: (t, l) => `Crea un esquema/mapa conceptual en texto jerárquico sobre "${t}" a nivel ${l}.` },
  { id: 'repaso', label: 'Plan de repaso', build: (t, l) => `Diseña un plan de repaso de 5 días para prepararme un examen de "${t}" a nivel ${l}.` },
];

const LEVELS = ['básico', 'intermedio', 'avanzado'];

export default function StudyPanel() {
  const { sendMessage } = useChat();
  const { rememberFact } = useSettings();
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermedio');
  const [action, setAction] = useState('explicar');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function handleGenerate(e) {
    e.preventDefault();
    if (!topic.trim()) return;
    const actionConfig = ACTIONS.find((a) => a.id === action);
    const prompt = actionConfig.build(topic.trim(), level);
    setLoading(true);
    setResult(null);
    const reply = await sendMessage(prompt, { mode: 'tutor' });
    setLoading(false);
    if (reply) {
      setResult(reply.content);
      rememberFact('nivel_academico', level);
      rememberFact('ultimo_tema_estudiado', topic.trim());
    }
  }

  return (
    <section className="study-panel">
      <form className="glass-panel study-form" onSubmit={handleGenerate}>
        <h2>Tutor académico</h2>
        <p className="study-form__hint">Elige un tema y qué quieres que Eddie prepare. La conversación también queda guardada en el Chat.</p>

        <label>
          <span className="field-label">Tema</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="p. ej. Claves foráneas en SQL" />
        </label>

        <div className="study-form__row">
          <label>
            <span className="field-label">Nivel</span>
            <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="field-label">Qué necesitas</span>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button type="submit" className="btn btn-primary" disabled={!topic.trim() || loading}>
          {loading ? 'Preparando…' : 'Generar con Eddie'}
        </button>
      </form>

      <div className="glass-panel study-result">
        <h2>Resultado</h2>
        {!result && !loading && <p className="study-result__placeholder">Aquí aparecerá lo que Eddie prepare para ti.</p>}
        {loading && <p className="study-result__placeholder">Analizando tu solicitud…</p>}
        {result && <RichText text={result} />}
      </div>
    </section>
  );
}
