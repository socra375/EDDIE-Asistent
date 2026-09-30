import { useMemo, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useSettings } from '../context/SettingsContext';
import Icon from './Icon';

export default function ChatList({ onOpenChat }) {
  const { conversations, conversationId, messages, loadConversation, deleteConversation, resetConversation } = useChat();
  const { settings } = useSettings();
  const [query, setQuery] = useState('');

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(settings.language, { dateStyle: 'short', timeStyle: 'short' }),
    [settings.language],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  function handleNew() {
    resetConversation();
    onOpenChat();
  }

  function handleOpen(id) {
    if (id !== conversationId) loadConversation(id);
    onOpenChat();
  }

  return (
    <aside className="chatlist" aria-label="Mis chats">
      <h2 className="chatlist__title">Mis chats</h2>
      <button type="button" className="chatlist__new" onClick={handleNew} disabled={messages.length === 0}>
        Nueva conversación
        <Icon name="plus" size={18} />
      </button>
      <label className="chatlist__search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Buscar en chats…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <ul className="chatlist__items">
        {items.map((c) => (
          <li key={c.id}>
            <div className={`chatlist__item ${c.id === conversationId ? 'chatlist__item--active' : ''}`}>
              <button type="button" className="chatlist__open" onClick={() => handleOpen(c.id)}>
                <span className="chatlist__name">{c.title}</span>
                <span className="chatlist__meta">
                  {dateFormatter.format(new Date(c.updatedAt))} · {c.messages.length} mensaje{c.messages.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                type="button"
                className="chatlist__delete"
                onClick={() => deleteConversation(c.id)}
                aria-label={`Eliminar "${c.title}"`}
                title="Eliminar"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="chatlist__empty">{query ? 'Ningún chat coincide con la búsqueda.' : 'Todavía no hay conversaciones.'}</li>
        )}
      </ul>
    </aside>
  );
}
