import { useState } from 'react';
import { useChat } from '../../context/ChatContext';
import RichText from '../Shared/RichText';
import './Code.css';

const LANGUAGES = ['JavaScript', 'Python', 'HTML/CSS', 'SQL', 'Java', 'C#', 'Otro'];

const ACTIONS = {
  explicar: (lang, code) => `Explica qué hace este código en ${lang}:\n\n\`\`\`\n${code}\n\`\`\``,
  depurar: (lang, code, extra) =>
    `Este código en ${lang} tiene un error. ${extra ? `El error es: ${extra}.` : 'Detecta el error y explica por qué ocurre.'}\n\n\`\`\`\n${code}\n\`\`\`\n\nPropón la solución con el código corregido.`,
  refactorizar: (lang, code) => `Refactoriza este código en ${lang} para que sea más claro y organizado, sin cambiar su comportamiento:\n\n\`\`\`\n${code}\n\`\`\``,
  ejemplo: (lang, code) => `A partir de este código en ${lang}, crea un ejemplo adicional que use un enfoque similar:\n\n\`\`\`\n${code}\n\`\`\``,
};

export default function CodePanel() {
  const { sendMessage } = useChat();
  const [language, setLanguage] = useState('JavaScript');
  const [code, setCode] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function runAction(actionId) {
    if (!code.trim()) return;
    const builder = ACTIONS[actionId];
    const prompt = actionId === 'depurar' ? builder(language, code, errorDetail) : builder(language, code);
    setLoading(true);
    setResult(null);
    const reply = await sendMessage(prompt, { mode: 'tecnico' });
    setLoading(false);
    if (reply) setResult(reply.content);
  }

  return (
    <section className="code-panel">
      <div className="glass-panel code-editor">
        <h2>Asistente de programación</h2>
        <div className="code-editor__row">
          <label>
            <span className="field-label">Lenguaje</span>
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span className="field-label">Código</span>
          <textarea
            className="textarea"
            rows={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Pega aquí tu código…"
          />
        </label>

        <label>
          <span className="field-label">Descripción del error (opcional)</span>
          <input className="input" value={errorDetail} onChange={(e) => setErrorDetail(e.target.value)} placeholder="p. ej. TypeError: undefined is not a function" />
        </label>

        <div className="code-editor__actions">
          <button type="button" className="btn btn-primary" disabled={!code.trim() || loading} onClick={() => runAction('explicar')}>
            Explicar
          </button>
          <button type="button" className="btn" disabled={!code.trim() || loading} onClick={() => runAction('depurar')}>
            Detectar errores
          </button>
          <button type="button" className="btn" disabled={!code.trim() || loading} onClick={() => runAction('refactorizar')}>
            Refactorizar
          </button>
          <button type="button" className="btn" disabled={!code.trim() || loading} onClick={() => runAction('ejemplo')}>
            Generar ejemplo
          </button>
        </div>
      </div>

      <div className="glass-panel code-result">
        <h2>Resultado</h2>
        {!result && !loading && <p className="code-result__placeholder">La explicación, corrección o refactor de Eddie aparecerá aquí.</p>}
        {loading && <p className="code-result__placeholder">Analizando tu código…</p>}
        {result && <RichText text={result} />}
      </div>
    </section>
  );
}
