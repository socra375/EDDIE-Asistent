import Icon from '../../layout/Icon';
import { SOURCE_LABELS } from '../../services/research';
import './ResearchCard.css';

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What the research agent found while Eddie answered: the memories that fit the
// request and, when it was about the outside world, the web (with the sources).
// Everything arrives already cleaned (services/research.js#sanitizeCard); the
// links open in a new tab. Collapsed by default: it is background, not the answer.
export default function ResearchCard({ card }) {
  if (!card) return null;
  if (card.status === 'running') {
    return (
      <div className="research research--running" role="status">
        <span className="research__spinner" aria-hidden="true" />
        <span>{card.note || 'Buscando en tu memoria y en la web…'}</span>
      </div>
    );
  }
  const results = card.web?.results || [];
  const found = card.memory.length + results.length + (card.web?.answer ? 1 : 0);
  const parts = [card.memory.length ? `${plural(card.memory.length, 'recuerdo', 'recuerdos')} en tu memoria` : '', results.length ? `${plural(results.length, 'fuente', 'fuentes')} de la web` : ''].filter(Boolean);
  const summary = found ? parts.join(' · ') || 'Resumen de la web' : card.note || 'Sin novedades';
  return (
    <details className={`research research--${card.status}`}>
      <summary className="research__summary">
        <Icon name="search" size={13} />
        <span className="research__label">Investigador</span>
        <span className="research__counts">{summary}</span>
      </summary>
      <div className="research__body">
        {card.web?.answer && <p className="research__answer">{card.web.answer}</p>}
        {results.length > 0 && (
          <ul className="research__list" aria-label="Fuentes de la web">
            {results.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.title}
                </a>
                <span className="research__host">{host(r.url)}</span>
                {r.snippet && <span className="research__snippet">{r.snippet}</span>}
              </li>
            ))}
          </ul>
        )}
        {card.memory.length > 0 && (
          <ul className="research__list" aria-label="Lo que encontré en tu memoria">
            {card.memory.map((m, i) => (
              <li key={`${m.source}-${i}`}>
                <span className="research__chip">{SOURCE_LABELS[m.source]}</span>
                {m.title && <strong className="research__title">{m.title}</strong>}
                <span className="research__snippet">{m.text}</span>
                {m.url && (
                  <a className="research__host" href={m.url} target="_blank" rel="noopener noreferrer">
                    {host(m.url)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {card.note && found > 0 && <p className="research__note">{card.note}</p>}
      </div>
    </details>
  );
}
