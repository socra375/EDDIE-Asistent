import Icon from './Icon';
import { EddieMark } from './EddieLogo';
import { MODULES, SETTINGS } from './modules';

function RailButton({ item, active, onSelect }) {
  return (
    <button
      type="button"
      className={`rail__item ${active ? 'rail__item--active' : ''}`}
      style={{ '--item-color': item.color }}
      onClick={() => onSelect(item.id)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-tooltip={item.label}
    >
      <Icon name={item.icon} />
    </button>
  );
}

export default function IconRail({ active, onSelect, chatListOpen, onToggleChatList }) {
  return (
    <nav className="rail" aria-label="Módulos">
      <button type="button" className="rail__logo" onClick={() => onSelect('home')} aria-label="Eddie · Inicio">
        <EddieMark size={40} />
      </button>
      <button
        type="button"
        className="rail__item rail__toggle"
        onClick={onToggleChatList}
        aria-label={chatListOpen ? 'Ocultar mis chats' : 'Mostrar mis chats'}
        aria-expanded={chatListOpen}
        data-tooltip={chatListOpen ? 'Ocultar chats' : 'Mis chats'}
      >
        <Icon name={chatListOpen ? 'panelClose' : 'panelOpen'} />
      </button>
      <div className="rail__group">
        {MODULES.map((m) => (
          <RailButton key={m.id} item={m} active={active === m.id} onSelect={onSelect} />
        ))}
      </div>
      <div className="rail__bottom">
        <RailButton item={SETTINGS} active={active === SETTINGS.id} onSelect={onSelect} />
      </div>
    </nav>
  );
}
